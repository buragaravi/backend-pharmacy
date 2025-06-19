const express = require('express');
const router = express.Router();
const { getNextVoucherId, incrementVoucherId } = require('../controllers/voucherController');


// Only admin and central_lab_admin can get next voucherId
router.get('/next', getNextVoucherId);
// Only admin and central_lab_admin can increment voucherId
router.post('/increment', incrementVoucherId);

module.exports = router;
