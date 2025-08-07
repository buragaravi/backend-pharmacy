const Quotation = require('../models/Quotation');
const Requirement = require('../models/Requirement');

/**
 * Convert approved requirement items to quotation format
 */
const convertRequirementItemsToQuotationFormat = (requirementItems) => {
  const quotationItems = {
    chemicals: [],
    equipment: [],
    glassware: []
  };

  requirementItems.forEach(item => {
    const quotationItem = {
      quantity: item.quantity,
      unit: item.unit,
      remarks: `From requirement: ${item.specifications || ''} ${item.remarks || ''}`.trim()
    };

    switch (item.itemType) {
      case 'chemical':
        quotationItems.chemicals.push({
          chemicalName: item.itemName,
          ...quotationItem
        });
        break;
      case 'equipment':
        quotationItems.equipment.push({
          equipmentName: item.itemName,
          specifications: item.specifications || '',
          ...quotationItem
        });
        break;
      case 'glassware':
        quotationItems.glassware.push({
          glasswareName: item.itemName,
          condition: 'new', // Default for new requirements
          ...quotationItem
        });
        break;
    }
  });

  return quotationItems;
};

/**
 * Find existing draft quotation or create new one
 */
const findOrCreateDraftQuotation = async (approvedBy, requirementId, priority) => {
  try {
    // First, try to find an existing draft quotation by central admin
    let existingDraft = await Quotation.findOne({
      createdByRole: 'central_store_admin',
      status: 'draft'
    }).sort({ createdAt: -1 }); // Get the most recent draft

    if (existingDraft) {
      console.log(`Found existing draft quotation: ${existingDraft._id}`);
      return existingDraft;
    }

    // If no draft exists, create a new one
    console.log('No existing draft found, creating new quotation');
    const newQuotation = new Quotation({
      createdByRole: 'central_store_admin',
      createdBy: approvedBy,
      quotationType: 'mixed', // Will be auto-determined by pre-save middleware
      status: 'draft',
      chemicals: [],
      equipment: [],
      glassware: [],
      comments: [{
        text: `Quotation created from approved requirement ${requirementId} (Priority: ${priority})`,
        author: approvedBy,
        role: 'central_store_admin'
      }]
    });

    await newQuotation.save();
    console.log(`Created new draft quotation: ${newQuotation._id}`);
    return newQuotation;
  } catch (error) {
    console.error('Error in findOrCreateDraftQuotation:', error);
    throw error;
  }
};

/**
 * Add requirement items to quotation
 */
const addRequirementItemsToQuotation = async (quotation, requirementItems, requirementId) => {
  try {
    const convertedItems = convertRequirementItemsToQuotationFormat(requirementItems);
    
    // Add items to existing arrays
    if (convertedItems.chemicals.length > 0) {
      quotation.chemicals.push(...convertedItems.chemicals);
    }
    
    if (convertedItems.equipment.length > 0) {
      quotation.equipment.push(...convertedItems.equipment);
    }
    
    if (convertedItems.glassware.length > 0) {
      quotation.glassware.push(...convertedItems.glassware);
    }

    // Add a comment about the addition
    quotation.comments.push({
      text: `Added ${requirementItems.length} items from requirement ${requirementId}`,
      author: quotation.createdBy,
      role: 'central_store_admin'
    });

    // Save the updated quotation
    await quotation.save();
    
    console.log(`Successfully added ${requirementItems.length} items to quotation ${quotation._id}`);
    return quotation;
  } catch (error) {
    console.error('Error adding items to quotation:', error);
    throw error;
  }
};

/**
 * Main function to convert approved requirement to quotation
 */
const convertApprovedRequirementToQuotation = async (requirement, approvedBy) => {
  try {
    console.log(`Converting requirement ${requirement.requirementId} to quotation`);

    // Find or create draft quotation
    const quotation = await findOrCreateDraftQuotation(
      approvedBy, 
      requirement.requirementId, 
      requirement.priority
    );

    // Add requirement items to quotation
    const updatedQuotation = await addRequirementItemsToQuotation(
      quotation, 
      requirement.items, 
      requirement.requirementId
    );

    // Update requirement status and link to quotation
    requirement.status = 'converted_to_quotation';
    requirement.quotationId = updatedQuotation._id;
    requirement.convertedAt = new Date();
    
    // Add a comment to the requirement
    requirement.comments.push({
      comment: `Requirement converted to quotation. Items added to quotation ${updatedQuotation._id}`,
      commentBy: approvedBy
    });

    await requirement.save();

    console.log(`Successfully converted requirement ${requirement.requirementId} to quotation ${updatedQuotation._id}`);
    
    return {
      quotation: updatedQuotation,
      requirement: requirement
    };
  } catch (error) {
    console.error('Error converting requirement to quotation:', error);
    throw error;
  }
};

module.exports = {
  convertApprovedRequirementToQuotation,
  findOrCreateDraftQuotation,
  addRequirementItemsToQuotation,
  convertRequirementItemsToQuotationFormat
};
