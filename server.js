// server.js
const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors'); // Import CORS middleware
const errorHandler = require('./middleware/errorHandler');
const analyticsRoutes = require('./routes/analyticsRoutes');
const { checkForExpiringChemicals } = require('./utils/expiryAlerts');
const productRoutes = require('./routes/productRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const voucherRoutes = require('./routes/voucherRoutes');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize Express app
const app = express();
// Enable CORS for all routes (allow any origin)
app.use(cors()); // This allows requests from any domain

// Body parser middleware
app.use(express.json());

// Swagger API docs
require('./swagger')(app);

// Routes
app.get('/', (req, res) => {
  res.send('🔬 Advanced Chemical Stock Management System API is running...');
});

// Mount API routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/chemicals', require('./routes/chemicalRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/quotations', require('./routes/quotationRoutes'));
app.use('/api/requests', require('./routes/requestRoutes'));
app.use('/api/transfers', require('./routes/transferRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));
app.use('/api/analytics', analyticsRoutes);
app.use('/api/experiments', require('./routes/experimentRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/products', productRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/indents', require('./routes/indentRoutes'));
app.use('/api/equipment', require('./routes/equipmentRoutes'));
app.use('/api/glassware', require('./routes/glasswareRoutes'));
app.use('/api/glassware-transactions', require('./routes/glasswareTransactionRoutes'));
app.use('/api/others', require('./routes/otherProductRoutes'));


// Global error handler (should be after routes)
app.use(errorHandler);
// Expiry check (can be scheduled later using cron)
checkForExpiringChemicals();
// Start server
const PORT = process.env.PORT || 7000;
app.listen(PORT, () =>
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
);
