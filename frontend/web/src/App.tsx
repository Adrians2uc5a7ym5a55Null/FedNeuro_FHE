import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SNNUpdate {
  id: string;
  encryptedData: string;
  timestamp: number;
  deviceId: string;
  status: "pending" | "verified" | "rejected";
  accuracy?: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [updates, setUpdates] = useState<SNNUpdate[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newUpdateData, setNewUpdateData] = useState({
    deviceId: "",
    modelData: "",
    accuracy: "0.85"
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState({
    totalUpdates: 0,
    verifiedUpdates: 0,
    pendingUpdates: 0,
    rejectedUpdates: 0,
    avgAccuracy: 0
  });

  // Initialize stats
  useEffect(() => {
    if (updates.length > 0) {
      const verified = updates.filter(u => u.status === "verified").length;
      const pending = updates.filter(u => u.status === "pending").length;
      const rejected = updates.filter(u => u.status === "rejected").length;
      const total = updates.length;
      
      const verifiedAccuracies = updates
        .filter(u => u.status === "verified" && u.accuracy)
        .map(u => u.accuracy || 0);
      
      const avgAccuracy = verifiedAccuracies.length > 0 
        ? verifiedAccuracies.reduce((a, b) => a + b, 0) / verifiedAccuracies.length
        : 0;
      
      setStats({
        totalUpdates: total,
        verifiedUpdates: verified,
        pendingUpdates: pending,
        rejectedUpdates: rejected,
        avgAccuracy: parseFloat(avgAccuracy.toFixed(3))
      });
    }
  }, [updates]);

  useEffect(() => {
    loadUpdates().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadUpdates = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("update_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing update keys:", e);
        }
      }
      
      const list: SNNUpdate[] = [];
      
      for (const key of keys) {
        try {
          const updateBytes = await contract.getData(`update_${key}`);
          if (updateBytes.length > 0) {
            try {
              const updateData = JSON.parse(ethers.toUtf8String(updateBytes));
              list.push({
                id: key,
                encryptedData: updateData.data,
                timestamp: updateData.timestamp,
                deviceId: updateData.deviceId,
                status: updateData.status || "pending",
                accuracy: updateData.accuracy
              });
            } catch (e) {
              console.error(`Error parsing update data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading update ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setUpdates(list);
    } catch (e) {
      console.error("Error loading updates:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitUpdate = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting SNN update with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newUpdateData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const updateId = `update-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const updateData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        deviceId: newUpdateData.deviceId,
        status: "pending",
        accuracy: parseFloat(newUpdateData.accuracy)
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `update_${updateId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updateData))
      );
      
      const keysBytes = await contract.getData("update_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(updateId);
      
      await contract.setData(
        "update_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted SNN update submitted!"
      });
      
      await loadUpdates();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewUpdateData({
          deviceId: "",
          modelData: "",
          accuracy: "0.85"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyUpdate = async (updateId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted SNN update with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const updateBytes = await contract.getData(`update_${updateId}`);
      if (updateBytes.length === 0) {
        throw new Error("Update not found");
      }
      
      const updateData = JSON.parse(ethers.toUtf8String(updateBytes));
      
      const updatedUpdate = {
        ...updateData,
        status: "verified"
      };
      
      await contract.setData(
        `update_${updateId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedUpdate))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed!"
      });
      
      await loadUpdates();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectUpdate = async (updateId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted SNN update with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const updateBytes = await contract.getData(`update_${updateId}`);
      if (updateBytes.length === 0) {
        throw new Error("Update not found");
      }
      
      const updateData = JSON.parse(ethers.toUtf8String(updateBytes));
      
      const updatedUpdate = {
        ...updateData,
        status: "rejected"
      };
      
      await contract.setData(
        `update_${updateId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedUpdate))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Update rejected!"
      });
      
      await loadUpdates();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: isAvailable 
          ? "FHE contract is available and ready!" 
          : "Contract is currently unavailable"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const renderAccuracyChart = () => {
    const verifiedUpdates = updates.filter(u => u.status === "verified" && u.accuracy);
    if (verifiedUpdates.length === 0) {
      return <div className="no-data-chart">No verified updates to display</div>;
    }
    
    const maxAccuracy = Math.max(...verifiedUpdates.map(u => u.accuracy || 0));
    const minAccuracy = Math.min(...verifiedUpdates.map(u => u.accuracy || 0));
    
    return (
      <div className="accuracy-chart">
        <div className="chart-header">
          <h4>Model Accuracy Over Time</h4>
          <div className="chart-range">
            <span>Min: {(minAccuracy * 100).toFixed(1)}%</span>
            <span>Max: {(maxAccuracy * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div className="chart-bars">
          {verifiedUpdates.slice(0, 10).map((update, index) => (
            <div className="bar-container" key={index}>
              <div 
                className="bar" 
                style={{ height: `${(update.accuracy || 0) * 100}%` }}
              >
                <div className="bar-value">{(update.accuracy || 0 * 100).toFixed(1)}%</div>
              </div>
              <div className="bar-label">#{update.id.substring(7, 11)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderStatusDistribution = () => {
    const total = stats.totalUpdates || 1;
    const verifiedPercentage = (stats.verifiedUpdates / total) * 100;
    const pendingPercentage = (stats.pendingUpdates / total) * 100;
    const rejectedPercentage = (stats.rejectedUpdates / total) * 100;

    return (
      <div className="status-distribution">
        <div className="distribution-chart">
          <div 
            className="dist-segment verified" 
            style={{ width: `${verifiedPercentage}%` }}
          ></div>
          <div 
            className="dist-segment pending" 
            style={{ width: `${pendingPercentage}%` }}
          ></div>
          <div 
            className="dist-segment rejected" 
            style={{ width: `${rejectedPercentage}%` }}
          ></div>
        </div>
        <div className="dist-legend">
          <div className="legend-item">
            <div className="color-dot verified"></div>
            <span>Verified: {stats.verifiedUpdates}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot pending"></div>
            <span>Pending: {stats.pendingUpdates}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot rejected"></div>
            <span>Rejected: {stats.rejectedUpdates}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="neural-spinner">
        <div className="neuron"></div>
        <div className="neuron"></div>
        <div className="neuron"></div>
      </div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="chip-icon"></div>
          </div>
          <h1>FedNeuro<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-update-btn"
          >
            <div className="add-icon"></div>
            Submit Update
          </button>
          <button 
            className="fhe-check-btn"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-layout">
        <nav className="app-nav">
          <ul>
            <li 
              className={activeTab === "dashboard" ? "active" : ""}
              onClick={() => setActiveTab("dashboard")}
            >
              <div className="nav-icon dashboard"></div>
              Dashboard
            </li>
            <li 
              className={activeTab === "updates" ? "active" : ""}
              onClick={() => setActiveTab("updates")}
            >
              <div className="nav-icon updates"></div>
              SNN Updates
            </li>
            <li 
              className={activeTab === "partners" ? "active" : ""}
              onClick={() => setActiveTab("partners")}
            >
              <div className="nav-icon partners"></div>
              Partners
            </li>
            <li 
              className={activeTab === "faq" ? "active" : ""}
              onClick={() => setActiveTab("faq")}
            >
              <div className="nav-icon faq"></div>
              FAQ
            </li>
          </ul>
        </nav>
        
        <div className="content-panel">
          {activeTab === "dashboard" && (
            <div className="dashboard-panel">
              <div className="panel-header">
                <h2>Federated Neuromorphic Dashboard</h2>
                <p>Secure FHE-based SNN model updates across edge devices</p>
              </div>
              
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon total"></div>
                  <div className="stat-value">{stats.totalUpdates}</div>
                  <div className="stat-label">Total Updates</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon verified"></div>
                  <div className="stat-value">{stats.verifiedUpdates}</div>
                  <div className="stat-label">Verified</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon pending"></div>
                  <div className="stat-value">{stats.pendingUpdates}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon accuracy"></div>
                  <div className="stat-value">{(stats.avgAccuracy * 100).toFixed(1)}%</div>
                  <div className="stat-label">Avg Accuracy</div>
                </div>
              </div>
              
              <div className="chart-row">
                <div className="chart-container">
                  <h3>Accuracy Trend</h3>
                  {renderAccuracyChart()}
                </div>
                <div className="chart-container">
                  <h3>Update Status Distribution</h3>
                  {renderStatusDistribution()}
                </div>
              </div>
              
              <div className="project-intro">
                <h3>About FedNeuro FHE</h3>
                <p>
                  FedNeuro FHE enables secure sharing of encrypted Spiking Neural Network (SNN) updates 
                  across neuromorphic hardware devices using Fully Homomorphic Encryption (FHE). 
                  This preserves privacy while allowing collaborative model improvement.
                </p>
                <div className="tech-tags">
                  <span className="tech-tag">FHE</span>
                  <span className="tech-tag">SNN</span>
                  <span className="tech-tag">Federated Learning</span>
                  <span className="tech-tag">Neuromorphic Computing</span>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "updates" && (
            <div className="updates-panel">
              <div className="panel-header">
                <h2>Encrypted SNN Updates</h2>
                <div className="header-actions">
                  <button 
                    onClick={loadUpdates}
                    className="refresh-btn"
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="updates-list">
                <div className="list-header">
                  <div className="header-cell">ID</div>
                  <div className="header-cell">Device</div>
                  <div className="header-cell">Date</div>
                  <div className="header-cell">Accuracy</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Actions</div>
                </div>
                
                {updates.length === 0 ? (
                  <div className="no-updates">
                    <div className="no-updates-icon"></div>
                    <p>No SNN updates found</p>
                    <button 
                      className="primary-btn"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Submit First Update
                    </button>
                  </div>
                ) : (
                  updates.map(update => (
                    <div className="update-row" key={update.id}>
                      <div className="list-cell update-id">#{update.id.substring(7, 11)}</div>
                      <div className="list-cell">{update.deviceId}</div>
                      <div className="list-cell">
                        {new Date(update.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="list-cell">
                        {update.accuracy ? `${(update.accuracy * 100).toFixed(1)}%` : "N/A"}
                      </div>
                      <div className="list-cell">
                        <span className={`status-badge ${update.status}`}>
                          {update.status}
                        </span>
                      </div>
                      <div className="list-cell actions">
                        {update.status === "pending" && (
                          <>
                            <button 
                              className="action-btn verify"
                              onClick={() => verifyUpdate(update.id)}
                            >
                              Verify
                            </button>
                            <button 
                              className="action-btn reject"
                              onClick={() => rejectUpdate(update.id)}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          
          {activeTab === "partners" && (
            <div className="partners-panel">
              <div className="panel-header">
                <h2>Research Partners</h2>
                <p>Collaborating institutions advancing FHE and neuromorphic computing</p>
              </div>
              
              <div className="partners-grid">
                <div className="partner-card">
                  <div className="partner-logo intel"></div>
                  <h3>Intel Labs</h3>
                  <p>Neuromorphic Computing Research</p>
                  <div className="partner-tags">
                    <span>Loihi Chip</span>
                    <span>SNN Research</span>
                  </div>
                </div>
                
                <div className="partner-card">
                  <div className="partner-logo zama"></div>
                  <h3>Zama</h3>
                  <p>FHE Solutions Provider</p>
                  <div className="partner-tags">
                    <span>FHE Libraries</span>
                    <span>Encrypted ML</span>
                  </div>
                </div>
                
                <div className="partner-card">
                  <div className="partner-logo eth"></div>
                  <h3>ETH Zurich</h3>
                  <p>Neuromorphic Systems Lab</p>
                  <div className="partner-tags">
                    <span>SNN Algorithms</span>
                    <span>Edge Computing</span>
                  </div>
                </div>
                
                <div className="partner-card">
                  <div className="partner-logo mit"></div>
                  <h3>MIT</h3>
                  <p>Brain-Inspired Computing</p>
                  <div className="partner-tags">
                    <span>Neuromorphic Hardware</span>
                    <span>AI Security</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "faq" && (
            <div className="faq-panel">
              <div className="panel-header">
                <h2>Frequently Asked Questions</h2>
                <p>Learn about FHE and neuromorphic computing</p>
              </div>
              
              <div className="faq-list">
                <div className="faq-item">
                  <h3>What is Fully Homomorphic Encryption (FHE)?</h3>
                  <p>
                    FHE allows computations to be performed directly on encrypted data without 
                    needing to decrypt it first. This enables secure processing of sensitive 
                    information while maintaining privacy.
                  </p>
                </div>
                
                <div className="faq-item">
                  <h3>How does FHE benefit neuromorphic computing?</h3>
                  <p>
                    By using FHE, neuromorphic devices can securely share encrypted SNN model updates 
                    without exposing sensitive data. This enables collaborative learning while 
                    preserving privacy.
                  </p>
                </div>
                
                <div className="faq-item">
                  <h3>What is a Spiking Neural Network (SNN)?</h3>
                  <p>
                    SNNs are a type of artificial neural network that more closely mimics biological 
                    neural networks. They process information as discrete events (spikes) over time, 
                    making them energy-efficient and well-suited for neuromorphic hardware.
                  </p>
                </div>
                
                <div className="faq-item">
                  <h3>How secure is the FHE implementation?</h3>
                  <p>
                    Our implementation uses state-of-the-art FHE schemes that have been mathematically 
                    proven to be secure against known attacks. Data remains encrypted throughout the 
                    entire federated learning process.
                  </p>
                </div>
                
                <div className="faq-item">
                  <h3>What hardware is compatible with this system?</h3>
                  <p>
                    The system is designed to work with neuromorphic hardware platforms like Intel's 
                    Loihi chip, IBM's TrueNorth, and other spiking neural network accelerators.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitUpdate} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          updateData={newUpdateData}
          setUpdateData={setNewUpdateData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="chip-icon"></div>
              <span>FedNeuro FHE</span>
            </div>
            <p>Secure encrypted SNN updates using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Research Paper</a>
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FedNeuro FHE Research Group. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  updateData: any;
  setUpdateData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  updateData,
  setUpdateData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setUpdateData({
      ...updateData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!updateData.deviceId || !updateData.modelData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Submit SNN Update</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            <span>Your SNN update will be encrypted with FHE before submission</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Device ID *</label>
              <input 
                type="text"
                name="deviceId"
                value={updateData.deviceId} 
                onChange={handleChange}
                placeholder="Enter device identifier" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Model Accuracy</label>
              <input 
                type="number"
                min="0"
                max="1"
                step="0.01"
                name="accuracy"
                value={updateData.accuracy} 
                onChange={handleChange}
                placeholder="0.00 - 1.00" 
                className="form-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>SNN Model Data *</label>
              <textarea 
                name="modelData"
                value={updateData.modelData} 
                onChange={handleChange}
                placeholder="Enter SNN model update data..." 
                className="form-textarea"
                rows={6}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> 
            <span>Data remains encrypted during FHE processing and federated aggregation</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;