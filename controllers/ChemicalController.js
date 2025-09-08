const asyncHandler = require('express-async-handler');
const ChemicalMaster = require('../models/ChemicalMaster');
const ChemicalLive = require('../models/ChemicalLive');
const Transaction = require('../models/Transaction');
const ExpiredChemicalLog = require('../models/ExpiredChemicalLog');
const OutOfStockChemical = require('../models/OutOfStockChemical');
const Lab = require('../models/Lab');
const { default: mongoose } = require('mongoose');

// Helper function to get valid lab IDs from database
let cachedLabIds = null;
let lastCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getValidLabIds() {
  try {
    // Check if we have cached data that's still valid
    const now = Date.now();
    if (cachedLabIds && lastCacheTime && (now - lastCacheTime) < CACHE_DURATION) {
      return cachedLabIds;
    }

    // Fetch fresh data from database
    const labs = await Lab.find({ isActive: true }).select('labId');
    const labIds = labs.map(lab => lab.labId);
    
    // Update cache
    cachedLabIds = labIds;
    lastCacheTime = now;
    
    return labIds;
  } catch (error) {
    console.error('Error fetching lab IDs:', error);
    // Return cached data if available, even if stale
    if (cachedLabIds) {
      console.warn('Using stale lab ID cache due to database error');
      return cachedLabIds;
    }
    // Ultimate fallback to empty array
    return [];
  }
}

// Helper: generate batch ID manually
function generateBatchId() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `BATCH-${ymd}-${random}`;
}

// Helper: get latest batch ID from DB
async function getLastUsedBatchId() {
  const latest = await ChemicalMaster.findOne({ batchId: { $exists: true } })
    .sort({ createdAt: -1 }) 
    .select('batchId');
  return latest?.batchId || null;
}

// Helper: Move chemical to out-of-stock
async function moveToOutOfStock(chemicalLiveDoc) {
  await OutOfStockChemical.findOneAndUpdate(
    { displayName: chemicalLiveDoc.displayName },
    {
      displayName: chemicalLiveDoc.displayName,
      unit: chemicalLiveDoc.unit,
      lastOutOfStock: new Date(),
    },
    { upsert: true }
  );
  await chemicalLiveDoc.deleteOne();
}

// Helper: Remove from out-of-stock if restocked
async function removeFromOutOfStock(displayName) {
  await OutOfStockChemical.deleteOne({ displayName });
}

// Helper: Re-index chemical names after a batch is deleted
async function reindexChemicalNames(displayName) {
  const batches = await ChemicalLive.find({
    displayName,
    labId: 'central-store',
    quantity: { $gt: 0 },
  }).sort({ expiryDate: 1 });
  if (batches.length === 0) return;
  // First batch gets base name, others get suffixes
  for (let i = 0; i < batches.length; i++) {
    let newName = displayName;
    if (i > 0) newName = `${displayName} - ${String.fromCharCode(65 + i - 1)}`;
    // Update both chemicalName and displayName for consistency
    batches[i].chemicalName = newName;
    await batches[i].save();
    // Also update master if needed
    await ChemicalMaster.updateOne(
      { _id: batches[i].chemicalMasterId },
      { chemicalName: newName }
    );
  }
}

// Patch: After allocation, handle out-of-stock and reindexing
async function handlePostAllocation(chemicalLiveDoc) {
  if (chemicalLiveDoc.quantity > 0) return;
  // Check for other batches with same displayName
  const others = await ChemicalLive.find({
    displayName: chemicalLiveDoc.displayName,
    labId: 'central-store',
    _id: { $ne: chemicalLiveDoc._id },
    quantity: { $gt: 0 },
  });
  if (others.length > 0) {
    // Delete this batch and reindex
    await chemicalLiveDoc.deleteOne();
    await reindexChemicalNames(chemicalLiveDoc.displayName);
  } else {
    // Move to out-of-stock
    await moveToOutOfStock(chemicalLiveDoc);
  }
}

// Patch: After adding to central, remove from out-of-stock if present
async function handleRestock(displayName) {
  await removeFromOutOfStock(displayName);
}

// Main controller
exports.addChemicalsToCentral = asyncHandler(async (req, res) => {
  const { chemicals, usePreviousBatchId } = req.body;

  if (!Array.isArray(chemicals) || chemicals.length === 0) {
    return res.status(400).json({ message: 'No chemicals provided' });
  }

  console.log('🔬 Adding chemicals to central store:', {
    count: chemicals.length,
    chemicals: chemicals.map(c => ({
      name: c.chemicalName,
      quantity: c.quantity,
      unit: c.unit,
      vendor: c.vendor,
      expiryDate: c.expiryDate
    }))
  });

  let batchId;
  if (usePreviousBatchId) {
    batchId = await getLastUsedBatchId();
  } else {
    batchId = generateBatchId();
  }

  const savedChemicals = [];

  for (const chem of chemicals) {
    try {
      let { productId, chemicalName, quantity, unit, expiryDate, vendor, pricePerUnit, department } = chem;
      
      // Validate required fields
      if (!chemicalName || !quantity || !unit || !vendor) {
        console.error('❌ Missing required fields for chemical:', {
          chemicalName,
          quantity,
          unit,
          vendor,
          expiryDate
        });
        continue; // Skip this chemical
      }
      
      // Convert expiry date if provided
      if (expiryDate) {
        try {
          expiryDate = new Date(expiryDate);
          if (isNaN(expiryDate.getTime())) {
            console.warn('⚠️ Invalid expiry date, treating as no-expiry:', expiryDate);
            expiryDate = null;
          }
        } catch (error) {
          console.warn('⚠️ Error parsing expiry date, treating as no-expiry:', error.message);
          expiryDate = null;
        }
      }
    // PATCH: Refined logic for no-expiry chemicals
    if (!expiryDate) {
      // Enhanced matching: find by base name (without suffix) and vendor, unit
      const baseName = chemicalName.split(' - ')[0]; // Remove any existing suffix
      const existingChems = await ChemicalMaster.find({
        $or: [
          { chemicalName: chemicalName }, // Exact match
          { chemicalName: new RegExp(`^${baseName}( - [A-Z])?$`, 'i') } // Base name with optional suffix
        ],
        vendor,
        unit
      });
      console.log('Existing no-expiry chemicals:', existingChems);
      // Check for a no-expiry batch (strict: only null or undefined)
      const noExpiryBatch = existingChems.find(c => c.expiryDate == null);
      
      console.log('🔍 No-expiry batch check:', {
        chemicalName,
        existingChems: existingChems.map(c => ({
          name: c.chemicalName,
          expiryDate: c.expiryDate,
          vendor: c.vendor,
          unit: c.unit
        })),
        noExpiryBatch: noExpiryBatch ? {
          name: noExpiryBatch.chemicalName,
          expiryDate: noExpiryBatch.expiryDate
        } : null
      });
      
      if (noExpiryBatch) {
        // Add to existing no-expiry batch
        noExpiryBatch.quantity += Number(quantity);
        noExpiryBatch.unit = unit; // Ensure unit is set
        noExpiryBatch.vendor = vendor || noExpiryBatch.vendor; // Update vendor if provided
        noExpiryBatch.pricePerUnit = pricePerUnit || noExpiryBatch.pricePerUnit; // Update price if provided
        noExpiryBatch.department = department || noExpiryBatch.department; // Update department if provided
        await noExpiryBatch.save();
        const live = await ChemicalLive.findOne({
          chemicalMasterId: noExpiryBatch._id,
          labId: 'central-store'
        });
        if (live) {
          live.quantity += Number(quantity);
          live.originalQuantity += Number(quantity);
          await live.save();
        } else {
          // Create missing ChemicalLive entry
          console.log(`⚠️ Missing ChemicalLive for master ${noExpiryBatch._id}, creating...`);
          await ChemicalLive.create({
            chemicalMasterId: noExpiryBatch._id,
            chemicalName: noExpiryBatch.chemicalName,
            displayName: noExpiryBatch.chemicalName.split(' - ')[0],
            unit: noExpiryBatch.unit,
            expiryDate: noExpiryBatch.expiryDate,
            labId: 'central-store',
            quantity: noExpiryBatch.quantity,
            originalQuantity: noExpiryBatch.quantity,
            isAllocated: false
          });
        }
        await createTransaction(
          noExpiryBatch.chemicalName, 'entry', noExpiryBatch._id,
          'central-store', 'central-store', quantity, unit, req.userId
        );
        
        // Remove from out-of-stock if this chemical was previously out-of-stock
        await handleRestock(chemicalName);
        
        savedChemicals.push(noExpiryBatch);
        continue;
      } else if (existingChems.length > 0) {
        // All existing batches have expiry, create a new no-expiry batch (base name, no suffix)
        const masterEntry = await createNewChemical(
          chemicalName, quantity, unit, null,
          batchId, vendor, pricePerUnit, department, req.userId, productId
        );
        savedChemicals.push(masterEntry);
        continue;
      } else {
        // No existing batch, create new no-expiry batch
        const masterEntry = await createNewChemical(
          chemicalName, quantity, unit, null,
          batchId, vendor, pricePerUnit, department, req.userId, productId
        );
        savedChemicals.push(masterEntry);
        continue;
      }
    }
    // 1. Enhanced matching: Check for existing chemical with same base name, vendor AND unit
    const baseName = chemicalName.split(' - ')[0]; // Remove any existing suffix
    const existingChems = await ChemicalMaster.find({
      $or: [
        { chemicalName: chemicalName }, // Exact match
        { chemicalName: new RegExp(`^${baseName}( - [A-Z])?$`, 'i') } // Base name with optional suffix
      ],
      vendor,
      unit
    });

    // 2. If no matching chemical exists
    if (existingChems.length === 0) {
      const masterEntry = await createNewChemical(
        chemicalName, quantity, unit, expiryDate,
        batchId, vendor, pricePerUnit, department, req.userId, productId
      );
      savedChemicals.push(masterEntry);
      continue;
    }

    // 3. Check for exact match (name+vendor+unit+expiry)
    const exactMatch = existingChems.find(c => {
      // Handle null/undefined expiry dates
      if (!c.expiryDate && !expiryDate) return true; // Both null/undefined
      if (!c.expiryDate || !expiryDate) return false; // One is null, other isn't
      return c.expiryDate.getTime() === expiryDate.getTime();
    });

    console.log('🔍 Exact match check:', {
      chemicalName,
      existingChems: existingChems.map(c => ({
        name: c.chemicalName,
        expiryDate: c.expiryDate,
        vendor: c.vendor,
        unit: c.unit
      })),
      targetExpiry: expiryDate,
      exactMatch: exactMatch ? {
        name: exactMatch.chemicalName,
        expiryDate: exactMatch.expiryDate
      } : null
    });

    if (exactMatch) {
      // Update quantities
      exactMatch.quantity += Number(quantity);
      await exactMatch.save();

      const live = await ChemicalLive.findOne({
        chemicalMasterId: exactMatch._id,
        labId: 'central-store'
      });
      if (live) {
        live.quantity += Number(quantity);
        live.originalQuantity += Number(quantity);
        await live.save();
      } else {
        // Create missing ChemicalLive entry
        console.log(`⚠️ Missing ChemicalLive for master ${exactMatch._id}, creating...`);
        await ChemicalLive.create({
          chemicalMasterId: exactMatch._id,
          chemicalName: exactMatch.chemicalName,
          displayName: exactMatch.chemicalName.split(' - ')[0],
          unit: exactMatch.unit,
          expiryDate: exactMatch.expiryDate,
          labId: 'central-store',
          quantity: exactMatch.quantity,
          originalQuantity: exactMatch.quantity,
          isAllocated: false
        });
      }

      await createTransaction(
        exactMatch.chemicalName, 'entry', exactMatch._id,
        'central-store', 'central-store', quantity, unit, req.userId
      );

      // Remove from out-of-stock if this chemical was previously out-of-stock
      await handleRestock(chemicalName);

      savedChemicals.push(exactMatch);
    } else {
      // Handle expiry date conflicts
      const newExpiry = expiryDate.getTime();
      const existingWithEarlierExpiry = existingChems.find(c => {
        // Skip chemicals with null/undefined expiry dates
        if (!c.expiryDate) return false;
        return c.expiryDate.getTime() < newExpiry;
      });

      if (existingWithEarlierExpiry) {
        // Existing has earlier expiry - it keeps name, new gets suffix
        const suffix = await getNextSuffix(chemicalName);
        const suffixedName = `${chemicalName} - ${suffix}`;

        const masterEntry = await createNewChemical(
          suffixedName, quantity, unit, expiryDate,
          batchId, vendor, pricePerUnit, department, req.userId, productId
        );
        savedChemicals.push(masterEntry);
      } else {
        // New has earlier expiry - rename existing, keep new as base
        const suffix = await getNextSuffix(chemicalName);

        // Rename all existing
        for (const chem of existingChems) {
          const newName = `${chemicalName} - ${suffix}`;
          chem.chemicalName = newName;
          await chem.save();

          const live = await ChemicalLive.findOne({
            chemicalMasterId: chem._id,
            labId: 'central-store'
          });
          if (live) {
            live.chemicalName = newName;
            await live.save();
          }
        }

        // Create new with base name
        const masterEntry = await createNewChemical(
          chemicalName, quantity, unit, expiryDate,
          batchId, vendor, pricePerUnit, department, req.userId, productId
        );
        savedChemicals.push(masterEntry);
      }
    }
    } catch (error) {
      console.error('❌ Error processing chemical:', {
        chemical: chem,
        error: error.message,
        stack: error.stack
      });
      // Continue with next chemical instead of failing entire batch
      continue;
    }
  }

  res.status(201).json({
    message: 'Chemicals added/updated successfully',
    batchId,
    chemicals: savedChemicals
  });
});

// Helper: Create new chemical (master + live)
async function createNewChemical(name, qty, unit, expiry, batchId, vendor, price, dept, userId, productId = null) {
  // Find or create Product for this chemical
  const Product = require('../models/Product');
  let product;
  
  if (productId) {
    // Use provided productId
    product = await Product.findById(productId);
    if (!product) {
      throw new Error(`Product with ID ${productId} not found`);
    }
  } else {
    // Find or create Product for this chemical
    product = await Product.findOne({ 
      name: name.split(' - ')[0], // Remove any suffix for product lookup
      category: 'chemical' 
    });
    
    if (!product) {
      product = await Product.create({
        name: name.split(' - ')[0],
        unit: unit,
        category: 'chemical',
        thresholdValue: 10 // Default threshold for chemicals
      });
    }
  }
  
  const masterEntry = await ChemicalMaster.create({
    productId: product._id,
    chemicalName: name,
    quantity: qty,
    unit,
    expiryDate: expiry,
    batchId,
    vendor,
    pricePerUnit: price,
    department: dept
  });

  try {
    await ChemicalLive.create({
      chemicalMasterId: masterEntry._id,
      chemicalName: masterEntry.chemicalName,
      displayName: name.split(' - ')[0], // Store clean name without suffix
      unit,
      expiryDate: expiry,
      labId: 'central-store',
      quantity: qty,
      originalQuantity: qty,
      isAllocated: false
    });
    console.log(`✅ Created ChemicalLive for master: ${masterEntry._id} (${name})`);
  } catch (error) {
    console.error(`❌ Failed to create ChemicalLive for master ${masterEntry._id}:`, error);
    // Don't throw here to avoid breaking the entire batch, but log the error
    // The diagnostic script will catch these missing entries
  }

  await createTransaction(
    masterEntry.chemicalName,
    'entry',
    masterEntry._id,
    'central-store',
    'central-store',
    qty,
    unit,
    userId
  );

  // Remove from out-of-stock if this chemical was previously out-of-stock
  await handleRestock(name.split(' - ')[0]);

  return masterEntry;
}

async function getNextSuffix(baseName) {
  const existing = await ChemicalMaster.find({
    chemicalName: new RegExp(`^${baseName} - [A-Z]$`, 'i')
  });

  const usedSuffixes = existing.map(c => {
    const parts = c.chemicalName.split(' - ');
    return parts[1]?.charAt(0);
  }).filter(Boolean);

  if (usedSuffixes.length === 0) return 'A';
  const lastChar = usedSuffixes.sort().pop().toUpperCase();
  return String.fromCharCode(lastChar.charCodeAt(0) + 1);
}

async function createTransaction(name, type, chemId, fromLab, toLab, qty, unit, userId) {
  return Transaction.create({
    chemicalName: name,
    transactionType: type,
    chemicalLiveId: chemId,
    fromLabId: fromLab,
    toLabId: toLab,
    quantity: qty,
    unit,
    createdBy: userId || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
    timestamp: new Date()
  });
}

// Allocate chemicals to lab (with FIFO enforcement and transaction safety)
exports.allocateChemicalsToLab = asyncHandler(async (req, res) => {
  const { labId, allocations } = req.body;

  // Input validation
  if (!labId || !Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({ message: 'labId and allocations required' });
  }

  // Validate lab ID dynamically from database
  const validLabIds = await getValidLabIds();
  if (!validLabIds.includes(labId) && labId !== 'central-store') {
    return res.status(400).json({ message: 'Invalid lab ID' });
  }

  console.log('🧪 Starting allocation process:', {
    labId,
    allocationCount: allocations.length,
    allocations: allocations.map(a => ({
      chemicalName: a.chemicalName,
      quantity: a.quantity
    }))
  });

  try {
    const results = [];
    let hasError = false;

    for (const alloc of allocations) {
      const { chemicalName, quantity } = alloc;
      if (!chemicalName || typeof quantity !== 'number' || quantity <= 0) {
        results.push({
          chemicalName,
          status: 'failed',
          reason: 'Invalid chemical name or quantity'
        });
        hasError = true;
        continue;
      }

      // Enhanced chemical finding with better matching
      let remainingQty = quantity;
      
      // Try exact match first
      let centralStocks = await ChemicalLive.find({
        displayName: chemicalName,
        labId: 'central-store',
        quantity: { $gt: 0 }
      }).sort({ expiryDate: 1 });
      
      // If no exact match, try case-insensitive and fuzzy matching
      if (centralStocks.length === 0) {
        const baseName = chemicalName.trim().replace(/\s+/g, ' ');
        centralStocks = await ChemicalLive.find({
          $or: [
            { displayName: new RegExp(`^${baseName}$`, 'i') },
            { displayName: new RegExp(`^${baseName.split(' - ')[0]}( - [A-Z])?$`, 'i') }
          ],
          labId: 'central-store',
          quantity: { $gt: 0 }
        }).sort({ expiryDate: 1 });
      }
      
      console.log('🔍 Found central stocks for allocation:', {
        chemicalName,
        foundStocks: centralStocks.length,
        stocks: centralStocks.map(s => ({
          displayName: s.displayName,
          quantity: s.quantity,
          expiryDate: s.expiryDate
        }))
      });

      if (!centralStocks.length) {
        results.push({
          chemicalName,
          status: 'failed',
          reason: 'Insufficient stock or not found'
        });
        hasError = true;
        continue;
      }

      let totalAllocated = 0;
      let lastExpiry = null;
      let lastCentralStock = null;
      let allocationFailed = false;
      const allocationSteps = []; // Track steps for potential rollback

      for (const centralStock of centralStocks) {
        if (remainingQty <= 0) break;
        const allocQty = Math.min(centralStock.quantity, remainingQty);
        
        try {
          // Decrement central stock with retry mechanism
          let updatedCentral = null;
          let retryCount = 0;
          const maxRetries = 3;
          
          while (retryCount < maxRetries && !updatedCentral) {
            // Get fresh stock data
            const freshStock = await ChemicalLive.findById(centralStock._id);
            if (!freshStock || freshStock.quantity < allocQty) {
              console.warn(`⚠️ Insufficient stock for ${chemicalName}: requested ${allocQty}, available ${freshStock?.quantity || 0}`);
              break;
            }
            
            updatedCentral = await ChemicalLive.findOneAndUpdate(
              {
                _id: centralStock._id,
                quantity: { $gte: allocQty }
              },
              { $inc: { quantity: -allocQty } },
              { new: true }
            );
            
            if (!updatedCentral) {
              retryCount++;
              if (retryCount < maxRetries) {
                console.warn(`⚠️ Retry ${retryCount}/${maxRetries} for ${chemicalName}`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
              }
            }
          }
          
          if (!updatedCentral) {
            console.error(`❌ Failed to allocate ${allocQty} of ${chemicalName} after ${maxRetries} retries`);
            allocationFailed = true;
            break;
          }
          
          // Track allocation step for potential rollback
          allocationSteps.push({
            centralStockId: centralStock._id,
            allocatedQty: allocQty,
            originalQty: centralStock.quantity
          });
          
          // PATCH: handle out-of-stock and reindexing with error handling
          try {
            await handlePostAllocation(updatedCentral);
          } catch (postAllocError) {
            console.error('⚠️ Error in post-allocation handling:', postAllocError.message);
            // Don't fail the allocation for this error, just log it
          }
        // Add/update lab stock
        const labStock = await ChemicalLive.findOneAndUpdate(
          {
            chemicalMasterId: centralStock.chemicalMasterId,
            labId
          },
          {
            $inc: { quantity: allocQty },
            $setOnInsert: {
              chemicalName: centralStock.chemicalName,
              displayName: centralStock.displayName,
              unit: centralStock.unit,
              expiryDate: centralStock.expiryDate,
              originalQuantity: allocQty,
              isAllocated: true
            }
          },
          {
            new: true,
            upsert: true
          }
        );
        // Create transaction record
        await Transaction.create({
          chemicalName: centralStock.chemicalName,
          transactionType: 'allocation',
          chemicalLiveId: labStock._id,
          fromLabId: 'central-store',
          toLabId: labId,
          quantity: allocQty,
          unit: centralStock.unit,
          createdBy: req.userId,
          timestamp: new Date()
        });
          totalAllocated += allocQty;
          lastExpiry = centralStock.expiryDate;
          lastCentralStock = centralStock;
          remainingQty -= allocQty;
        } catch (stepError) {
          console.error(`❌ Error in allocation step for ${chemicalName}:`, stepError.message);
          allocationFailed = true;
          break;
        }
      }

      if (allocationFailed || totalAllocated < quantity) {
        hasError = true;
        
        // Rollback partial allocations
        if (allocationSteps.length > 0) {
          console.log(`🔄 Rolling back ${allocationSteps.length} allocation steps for ${chemicalName}`);
          try {
            for (const step of allocationSteps) {
              await ChemicalLive.findByIdAndUpdate(
                step.centralStockId,
                { $inc: { quantity: step.allocatedQty } }
              );
            }
            console.log(`✅ Successfully rolled back allocations for ${chemicalName}`);
          } catch (rollbackError) {
            console.error(`❌ Failed to rollback allocations for ${chemicalName}:`, rollbackError.message);
          }
        }
        
        results.push({
          chemicalName,
          status: 'failed',
          reason: 'Insufficient stock or concurrency error',
          allocatedQuantity: totalAllocated,
          attemptedSteps: allocationSteps.length
        });
        continue;
      }

      results.push({
        chemicalName,
        status: 'success',
        allocatedQuantity: totalAllocated,
        expiryDate: lastExpiry,
        chemicalMasterId: lastCentralStock ? lastCentralStock.chemicalMasterId : undefined
      });
    }

    if (hasError) {
      return res.status(400).json({
        message: 'Some allocations failed',
        results
      });
    }

    res.status(200).json({
      message: 'All allocations completed successfully',
      results
    });

  } catch (error) {
    console.error('Allocation error:', error);
    res.status(500).json({
      message: 'Allocation process failed',
      error: error.message
    });
  }
});

// Get all Central Store master chemicals
exports.getCentralMasterChemicals = asyncHandler(async (req, res) => {
  const chemicals = await ChemicalMaster.find().sort({ createdAt: -1 });
  res.status(200).json(chemicals);
});

// Get live stock of Central Store (frontend sees displayName)
exports.getCentralLiveStock = asyncHandler(async (req, res) => {
  const stock = await ChemicalLive.find({ labId: 'central-store' })
    .select('displayName quantity unit expiryDate chemicalMasterId')
    .populate('chemicalMasterId', 'batchId vendor');
  res.status(200).json(stock);
});

// Get live stock by lab (frontend sees displayName)
exports.getLiveStockByLab = asyncHandler(async (req, res) => {
  const { labId } = req.params;
  const stock = await ChemicalLive.find({ labId })
    .select('displayName quantity unit expiryDate chemicalMasterId originalQuantity')
    .populate('chemicalMasterId', 'batchId vendor');
  res.status(200).json(stock);
});

// Get master chemicals of a specific lab
exports.getLabMasterChemicals = asyncHandler(async (req, res) => {
  const { labId } = req.params;
  const labLiveChemicals = await ChemicalLive.find({ labId })
    .populate('chemicalMasterId');
  const masterChemicals = labLiveChemicals.map(item => item.chemicalMasterId);
  res.status(200).json(masterChemicals);
});

// Get all transactions
exports.getAllTransactions = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find()
    .populate('chemicalLiveId')
    .sort({ timestamp: -1 });
  res.status(200).json(transactions);
});

// Get chemical distribution across labs
exports.getChemicalDistribution = asyncHandler(async (req, res) => {
  try {
    // First get all master chemicals with their price info
    const masterChemicals = await ChemicalMaster.find({})
      .select('chemicalName pricePerUnit')
      .lean();

    // Create a price lookup map
    const priceMap = masterChemicals.reduce((acc, chem) => {
      acc[chem.chemicalName] = chem.pricePerUnit || 0;
      return acc;
    }, {});

    // Get distribution with additional metrics
    const distribution = await ChemicalLive.aggregate([
      {
        $group: {
          _id: "$labId",
          totalChemicals: { $sum: 1 },
          totalQuantity: { $sum: "$quantity" },
          chemicals: {
            $push: {
              name: "$displayName",
              quantity: "$quantity",
              unit: "$unit",
              expiryDate: "$expiryDate"
            }
          },
          expiringCount: {
            $sum: {
              $cond: [
                {
                  $lte: [
                    { $subtract: ["$expiryDate", new Date()] },
                    1000 * 60 * 60 * 24 * 30 // 30 days in milliseconds
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          labId: "$_id",
          totalChemicals: 1,
          totalQuantity: 1,
          chemicals: 1,
          expiringCount: 1,
          _id: 0
        }
      }
    ]);

    // Normalize lab IDs and ensure all labs are represented
    const dynamicLabIds = await getValidLabIds();
    const validLabIds = ['central-store', ...dynamicLabIds];
    const completeDistribution = validLabIds.map(labId => {
      const labData = distribution.find(d => d.labId === labId) || {
        labId,
        totalChemicals: 0,
        totalQuantity: 0,
        chemicals: [],
        expiringCount: 0
      };

      // Add empty arrays if undefined
      if (!labData.chemicals) {
        labData.chemicals = [];
      }

      // Ensure all chemicals have valid values
      labData.chemicals = labData.chemicals.map(chem => ({
        ...chem,
        quantity: Number(chem.quantity) || 0,
        value: (Number(chem.quantity) || 0) * (priceMap[chem.name] || 0)
      }));

      // Recalculate totals to ensure accuracy
      labData.totalChemicals = labData.chemicals.length;
      labData.totalQuantity = labData.chemicals.reduce((sum, chem) => sum + (Number(chem.quantity) || 0), 0);
      labData.totalValue = labData.chemicals.reduce((sum, chem) => sum + (chem.value || 0), 0);

      return labData;
    });

    res.status(200).json(completeDistribution);
  } catch (error) {
    console.error('Error in chemical distribution:', error);
    res.status(500).json({
      message: 'Failed to fetch chemical distribution',
      error: error.message
    });
  }
});

// Get simplified live chemicals for allocation form
exports.getCentralLiveSimplified = asyncHandler(async (req, res) => {
  try {
    // Only fetch chemicals with quantity > 0
    const stock = await ChemicalLive.find({ 
      labId: 'central-store',
      quantity: { $gt: 0 } // Only return chemicals with available stock
    })
      .select('_id displayName quantity unit expiryDate chemicalMasterId')
      .populate('chemicalMasterId', 'pricePerUnit batchId vendor'); // Get additional fields

    console.log('🔍 Central available chemicals:', {
      totalFound: stock.length,
      chemicals: stock.map(s => ({
        displayName: s.displayName,
        quantity: s.quantity,
        unit: s.unit,
        chemicalMasterId: s.chemicalMasterId?._id
      }))
    });

    const simplified = stock.map(item => ({
      _id: item._id,
      chemicalMasterId: item.chemicalMasterId?._id, // Return the ID string, not the populated object
      chemicalName: item.displayName, // Frontend sees clean name
      displayName: item.displayName, // Also include displayName for consistency
      quantity: item.quantity,
      unit: item.unit,
      expiryDate: item.expiryDate,
      pricePerUnit: item.chemicalMasterId?.pricePerUnit || null,
      batchId: item.chemicalMasterId?.batchId || null,
      vendor: item.chemicalMasterId?.vendor || null
    }));

    console.log('📤 Returning simplified chemicals:', {
      count: simplified.length,
      sample: simplified.slice(0, 3).map(s => ({
        name: s.chemicalName,
        quantity: s.quantity,
        unit: s.unit,
        chemicalMasterId: s.chemicalMasterId
      }))
    });

    res.status(200).json(simplified);
  } catch (error) {
    console.error('Error fetching simplified stock:', error);
    res.status(500).json({ message: 'Failed to fetch stock data' });
  }
});

// Get expired chemicals for central-store
exports.getExpiredChemicals = asyncHandler(async (req, res) => {
  const now = new Date();
  const expired = await ChemicalLive.find({
    labId: 'central-store',
    expiryDate: { $lt: now }
  });
  res.status(200).json(expired);
});

// Process admin action for expired chemical
// action: 'merge', 'delete', 'update_expiry'
exports.processExpiredChemicalAction = asyncHandler(async (req, res) => {
  // Accept both chemicalLiveId and chemicalId for backward/forward compatibility
  const chemicalId = req.body.chemicalLiveId || req.body.chemicalId;
  const { action, mergeToId, newExpiryDate, reason } = req.body;
  const userId = req.user?._id || req.userId;
  const chem = await ChemicalLive.findById(chemicalId);
  if (!chem) return res.status(404).json({ message: 'ChemicalLive not found' });

  if (action === 'merge') {
    if (!mergeToId) return res.status(400).json({ message: 'Invalid merge target ID' });
    const mergeTo = await ChemicalLive.findById(mergeToId);
    if (!mergeTo) return res.status(404).json({ message: 'Target chemical not found' });
    mergeTo.quantity += chem.quantity;
    mergeTo.originalQuantity += chem.quantity;
    await mergeTo.save();
    // Always log, even if quantity is 0
    await ExpiredChemicalLog.create({
      chemicalLiveId: chem._id,
      chemicalName: chem.displayName,
      unit: chem.unit,
      quantity: chem.quantity,
      expiryDate: chem.expiryDate,
      deletedBy: userId,
      reason: reason || 'Merged to another chemical',
      labId: chem.labId,
      chemicalMasterId: chem.chemicalMasterId
    });
    await chem.deleteOne();
    return res.json({ message: 'Merged and deleted expired chemical' });
  } else if (action === 'delete') {
    // Just delete
    // Always log, even if quantity is 0
    await ExpiredChemicalLog.create({
      chemicalLiveId: chem._id,
      chemicalName: chem.displayName,
      unit: chem.unit,
      quantity: chem.quantity,
      expiryDate: chem.expiryDate,
      deletedBy: userId,
      reason: reason || 'Deleted expired chemical',
      labId: chem.labId,
      chemicalMasterId: chem.chemicalMasterId
    });
    await chem.deleteOne();
    return res.json({ message: 'Deleted expired chemical' });
  } else if (action === 'update_expiry') {
    // Update expiry date
    chem.expiryDate = newExpiryDate;
    await chem.save();
    return res.json({ message: 'Expiry date updated' });
  } else {
    return res.status(400).json({ message: 'Invalid action' });
  }
});

// Endpoint: Get all out-of-stock chemicals
exports.getOutOfStockChemicals = asyncHandler(async (req, res) => {
  const outOfStock = await OutOfStockChemical.find().sort({ lastOutOfStock: -1 });
  res.status(200).json(outOfStock);
});