const Voucher = require('../models/Voucher');
const asyncHandler = require('express-async-handler');

// Allowed categories for vouchers
const ALLOWED_CATEGORIES = ['invoice', 'request', 'allocation', 'indent', 'quotation'];

// @desc    Get current voucher ID for a category (do not increment or create new)
// @route   GET /api/vouchers/next?category=invoice
// @access  Private (role-safe)
const getNextVoucherId = asyncHandler(async (req, res) => {
  const { category } = req.query;
  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Valid category is required' });
  }
  // Find voucher for this category
  let voucher = await Voucher.findOne({ category });
  if (!voucher) {
    // If not found, create with 0
    voucher = await Voucher.create({ voucherId: 0, category });
  }
  res.status(200).json({ voucherId: voucher.voucherId, category: voucher.category });
});

// @desc    Increment voucher ID for a category (called after successful invoice creation)
// @route   POST /api/vouchers/increment
// @access  Private (role-safe)
const incrementVoucherId = asyncHandler(async (req, res) => {
  const { category } = req.body;
  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'Valid category is required' });
  }
  let voucher = await Voucher.findOne({ category });
  if (!voucher) {
    voucher = await Voucher.create({ voucherId: 1, category });
  } else {
    voucher.voucherId += 1;
    await voucher.save();
  }
  res.status(200).json({ voucherId: voucher.voucherId, category: voucher.category });
});

module.exports = { getNextVoucherId, incrementVoucherId };
