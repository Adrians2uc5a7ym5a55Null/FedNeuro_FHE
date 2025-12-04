// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FedNeuro is SepoliaConfig {
    // Encrypted SNN update structure
    struct EncryptedSNNUpdate {
        uint256 modelId;             // Model version identifier
        address deviceAddress;       // Device submitting update
        euint32[] encryptedWeights;  // Encrypted weight updates
        euint32[] encryptedBiases;   // Encrypted bias updates
        uint256 timestamp;           // Submission time
    }
    
    // Decrypted model structure
    struct DecryptedModel {
        string modelName;
        uint32[] weights;            // Decrypted weights
        uint32[] biases;             // Decrypted biases
        bool isReleased;             // Release status
    }

    // Contract state
    uint256 public globalModelVersion;
    mapping(uint256 => EncryptedSNNUpdate) public encryptedUpdates;
    mapping(uint256 => DecryptedModel) public decryptedModels;
    mapping(address => uint256) private deviceLastUpdate;
    
    // Aggregation state
    euint32[] private aggregatedWeights;
    euint32[] private aggregatedBiases;
    uint256 public updateCount;
    
    // Events
    event UpdateSubmitted(uint256 indexed modelId, address indexed device);
    event ModelAggregated(uint256 indexed modelId, uint256 updateCount);
    event ModelDecrypted(uint256 indexed modelId);
    
    // Modifier to ensure only valid devices can submit
    modifier validDevice() {
        require(deviceLastUpdate[msg.sender] < block.timestamp - 1 hours, 
                "Devices must wait 1 hour between updates");
        _;
    }
    
    /// @notice Submit encrypted SNN update from neuromorphic device
    function submitEncryptedUpdate(
        euint32[] calldata encryptedWeights,
        euint32[] calldata encryptedBiases
    ) external validDevice {
        require(encryptedWeights.length == encryptedBiases.length, 
                "Input arrays must match length");
        
        globalModelVersion += 1;
        uint256 newModelId = globalModelVersion;
        
        encryptedUpdates[newModelId] = EncryptedSNNUpdate({
            modelId: newModelId,
            deviceAddress: msg.sender,
            encryptedWeights: encryptedWeights,
            encryptedBiases: encryptedBiases,
            timestamp: block.timestamp
        });
        
        // Initialize aggregation if first update
        if (aggregatedWeights.length == 0) {
            aggregatedWeights = encryptedWeights;
            aggregatedBiases = encryptedBiases;
        } else {
            // Homomorphic aggregation
            for (uint i = 0; i < aggregatedWeights.length; i++) {
                aggregatedWeights[i] = FHE.add(
                    aggregatedWeights[i], 
                    encryptedWeights[i]
                );
                aggregatedBiases[i] = FHE.add(
                    aggregatedBiases[i], 
                    encryptedBiases[i]
                );
            }
        }
        
        updateCount += 1;
        deviceLastUpdate[msg.sender] = block.timestamp;
        
        emit UpdateSubmitted(newModelId, msg.sender);
    }
    
    /// @notice Finalize aggregation and store global model
    function finalizeGlobalModel() external {
        require(updateCount > 0, "No updates to aggregate");
        require(aggregatedWeights.length > 0, "Aggregation not initialized");
        
        uint256 currentModelId = globalModelVersion;
        
        // Store aggregated encrypted model
        encryptedUpdates[currentModelId] = EncryptedSNNUpdate({
            modelId: currentModelId,
            deviceAddress: address(0), // System address
            encryptedWeights: aggregatedWeights,
            encryptedBiases: aggregatedBiases,
            timestamp: block.timestamp
        });
        
        emit ModelAggregated(currentModelId, updateCount);
        
        // Reset for next round
        delete aggregatedWeights;
        delete aggregatedBiases;
        updateCount = 0;
    }
    
    /// @notice Request model decryption
    function requestModelDecryption(uint256 modelId) external {
        require(modelId <= globalModelVersion, "Invalid model ID");
        require(!decryptedModels[modelId].isReleased, "Model already decrypted");
        
        EncryptedSNNUpdate storage model = encryptedUpdates[modelId];
        require(model.timestamp > 0, "Model not found");
        
        // Prepare ciphertexts for decryption
        bytes32[] memory ciphertexts = new bytes32[](
            model.encryptedWeights.length + 
            model.encryptedBiases.length
        );
        
        uint j = 0;
        for (uint i = 0; i < model.encryptedWeights.length; i++) {
            ciphertexts[j++] = FHE.toBytes32(model.encryptedWeights[i]);
        }
        for (uint i = 0; i < model.encryptedBiases.length; i++) {
            ciphertexts[j++] = FHE.toBytes32(model.encryptedBiases[i]);
        }
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(
            ciphertexts, 
            this.decryptModelCallback.selector
        );
        
        // Store request mapping
        requestToModelId[reqId] = modelId;
        
        emit DecryptionRequested(modelId);
    }
    
    /// @notice FHE decryption callback
    function decryptModelCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 modelId = requestToModelId[requestId];
        require(modelId != 0, "Invalid request");
        
        // Verify proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Decode decrypted weights and biases
        uint32[] memory weights = new uint32[](aggregatedWeights.length);
        uint32[] memory biases = new uint32[](aggregatedBiases.length);
        
        (weights, biases) = abi.decode(cleartexts, (uint32[], uint32[]));
        
        // Store decrypted model
        decryptedModels[modelId] = DecryptedModel({
            modelName: string(abi.encodePacked("FedNeuro-v", modelId)),
            weights: weights,
            biases: biases,
            isReleased: true
        });
        
        emit ModelDecrypted(modelId);
    }
    
    /// @notice Get decrypted model details
    function getDecryptedModel(uint256 modelId) 
        external 
        view 
        returns (
            string memory modelName,
            uint32[] memory weights,
            uint32[] memory biases,
            bool isReleased
        ) 
    {
        DecryptedModel storage m = decryptedModels[modelId];
        return (m.modelName, m.weights, m.biases, m.isReleased);
    }
    
    /// @notice Get encrypted model parameters
    function getEncryptedModel(uint256 modelId) 
        external 
        view 
        returns (
            euint32[] memory encryptedWeights,
            euint32[] memory encryptedBiases
        ) 
    {
        EncryptedSNNUpdate storage m = encryptedUpdates[modelId];
        return (m.encryptedWeights, m.encryptedBiases);
    }
    
    // Request tracking mapping
    mapping(uint256 => uint256) private requestToModelId;
    
    // Decryption request event
    event DecryptionRequested(uint256 indexed modelId);
}