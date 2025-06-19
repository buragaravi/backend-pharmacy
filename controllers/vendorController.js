const Vendor = require('../models/vendorModel');
const asyncHandler = require('express-async-handler');
const { validateVendorInput } = require('../utils/validators');

// @desc    Create a new vendor
// @route   POST /api/vendors
// @access  Private/Admin
const createVendor = asyncHandler(async (req, res) => {
  const { name, address, phone, website, description } = req.body;

  // Validate input
  const { valid, errors } = validateVendorInput(req.body);
  if (!valid) {
    res.status(400);
    throw new Error(Object.values(errors).join(', '));
  }

  // Check if vendor already exists
  const vendorExists = await Vendor.findOne({ name });
  if (vendorExists) {
    res.status(400);
    throw new Error('Vendor already exists');
  }

  const vendor = await Vendor.create({
    name,
    address,
    phone,
    website,
    description
  });

  if (vendor) {
    res.status(201).json({
      _id: vendor._id,
      name: vendor.name,
      vendorCode: vendor.vendorCode,
      address: vendor.address,
      phone: vendor.phone,
      website: vendor.website,
      description: vendor.description
    });
  } else {
    res.status(400);
    throw new Error('Invalid vendor data');
  }
});

// @desc    Get all vendors
// @route   GET /api/vendors
// @access  Public
const getVendors = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  
  let query = {};
  
  if (search) {
    query = { $text: { $search: search } };
  }
  
  const vendors = await Vendor.find(query)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .sort({ createdAt: -1 });
    
  const count = await Vendor.countDocuments(query);
  
  res.json({
    vendors,
    totalPages: Math.ceil(count / limit),
    currentPage: page
  });
});

// @desc    Get single vendor
// @route   GET /api/vendors/:id
// @access  Public
const getVendorById = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  
  if (vendor) {
    res.json(vendor);
  } else {
    res.status(404);
    throw new Error('Vendor not found');
  }
});

// @desc    Update vendor
// @route   PUT /api/vendors/:id
// @access  Private/Admin
const updateVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  
  if (!vendor) {
    res.status(404);
    throw new Error('Vendor not found');
  }
  
  // Validate input
  const { valid, errors } = validateVendorInput(req.body);
  if (!valid) {
    res.status(400);
    throw new Error(Object.values(errors).join(', '));
  }
  
  vendor.name = req.body.name || vendor.name;
  vendor.address = req.body.address || vendor.address;
  vendor.phone = req.body.phone || vendor.phone;
  vendor.website = req.body.website || vendor.website;
  vendor.description = req.body.description || vendor.description;
  
  const updatedVendor = await vendor.save();
  
  res.json({
    _id: updatedVendor._id,
    name: updatedVendor.name,
    vendorCode: updatedVendor.vendorCode,
    address: updatedVendor.address,
    phone: updatedVendor.phone,
    website: updatedVendor.website,
    description: updatedVendor.description
  });
});

// @desc    Delete vendor
// @route   DELETE /api/vendors/:id
// @access  Private/Admin
const deleteVendor = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const product = await Vendor.findByIdAndDelete(id);
  
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  res.status(200).json({
    success: true,
    message: 'Product deleted successfully'
  });
});

// @desc    Search vendors
// @route   GET /api/vendors/search
// @access  Public
// In controller
const searchVendors = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const products = await Vendor.find({ 
    name: { $regex: q, $options: 'i' } 
  });
  res.status(200).json({ success: true, data: products });
});
module.exports = {
  createVendor,
  getVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
  searchVendors
};