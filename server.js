// server.js
const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors');
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

// Enable CORS with specific configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost and common frontend domains
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      /\.onrender\.com$/,
      /\.vercel\.app$/,
      /\.netlify\.app$/
    ];
    
    const isAllowed = allowedOrigins.some(pattern => {
      if (typeof pattern === 'string') {
        return origin === pattern;
      }
      return pattern.test(origin);
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS Debug - Origin allowed:', origin);
      callback(null, true); // Allow all origins for now to debug
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization']
};

app.use(cors(corsOptions));

// Body parser
app.use(express.json());

// Swagger docs
require('./swagger')(app);

// Professional landing route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>JITS Pharmacy - Chemical Stock Management System</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { 
          margin: 0; 
          padding: 0; 
          box-sizing: border-box; 
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          min-height: 100vh;
          color: #2c3e50;
          line-height: 1.6;
        }
        
        .header {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
          padding: 1rem 0;
          position: fixed;
          width: 100%;
          top: 0;
          z-index: 1000;
        }
        
        .nav {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 2rem;
        }
        
        .logo {
          font-size: 1.5rem;
          font-weight: 700;
          color: #2c3e50;
          text-decoration: none;
        }
        
        .nav-links {
          display: flex;
          gap: 2rem;
          list-style: none;
        }
        
        .nav-links a {
          color: #2c3e50;
          text-decoration: none;
          font-weight: 500;
          transition: color 0.3s ease;
        }
        
        .nav-links a:hover {
          color: #3498db;
        }
        
        .main-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 8rem 2rem 2rem;
          text-align: center;
        }
        
        .hero-section {
          margin-bottom: 4rem;
        }
        
        .hero-title {
          font-size: 3.5rem;
          font-weight: 700;
          color: #2c3e50;
          margin-bottom: 1rem;
          line-height: 1.2;
        }
        
        .hero-subtitle {
          font-size: 1.25rem;
          color: #7f8c8d;
          margin-bottom: 2rem;
          max-width: 600px;
          margin-left: auto;
          margin-right: auto;
        }
        
        .cta-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
          flex-wrap: wrap;
        }
        
        .btn {
          padding: 1rem 2rem;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          cursor: pointer;
        }
        
        .btn-primary {
          background: #3498db;
          color: white;
          box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);
        }
        
        .btn-primary:hover {
          background: #2980b9;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(52, 152, 219, 0.4);
        }
        
        .btn-secondary {
          background: white;
          color: #3498db;
          border: 2px solid #3498db;
        }
        
        .btn-secondary:hover {
          background: #3498db;
          color: white;
          transform: translateY(-2px);
        }
        
        .features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 2rem;
          margin-top: 4rem;
        }
        
        .feature-card {
          background: rgba(255, 255, 255, 0.9);
          padding: 2rem;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          transition: transform 0.3s ease;
        }
        
        .feature-card:hover {
          transform: translateY(-5px);
        }
        
        .feature-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }
        
        .feature-title {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: #2c3e50;
        }
        
        .feature-description {
          color: #7f8c8d;
        }
        
        .footer {
          margin-top: 4rem;
          padding: 2rem 0;
          text-align: center;
          color: #7f8c8d;
          font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
          .hero-title {
            font-size: 2.5rem;
          }
          
          .nav-links {
            display: none;
          }
          
          .cta-buttons {
            flex-direction: column;
            align-items: center;
          }
          
          .btn {
            width: 100%;
            max-width: 300px;
          }
        }
      </style>
    </head>
    <body>
      <header class="header">
        <nav class="nav">
          <a href="/" class="logo">JITS Pharmacy</a>
          <ul class="nav-links">
            <li><a href="/api-docs">API Documentation</a></li>
            <li><a href="#features">Features</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>
      </header>
      
      <main class="main-content">
        <section class="hero-section">
          <h1 class="hero-title">Chemical Stock Management System</h1>
          <p class="hero-subtitle">
            Advanced laboratory inventory management solution for efficient tracking, 
            monitoring, and optimization of chemical stocks and laboratory resources.
          </p>
          <div class="cta-buttons">
            <a href="/api-docs" class="btn btn-primary">
              📚 View API Documentation
            </a>
            <a href="#features" class="btn btn-secondary">
              🔍 Explore Features
            </a>
          </div>
        </section>
        
        <section class="features" id="features">
          <div class="feature-card">
            <div class="feature-icon">🧪</div>
            <h3 class="feature-title">Chemical Inventory</h3>
            <p class="feature-description">
              Comprehensive tracking of chemical stocks with expiry monitoring, 
              quantity management, and automated alerts.
            </p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h3 class="feature-title">Analytics & Reports</h3>
            <p class="feature-description">
              Real-time analytics, usage patterns, and detailed reporting 
              for informed decision making.
            </p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">🔒</div>
            <h3 class="feature-title">Secure Access</h3>
            <p class="feature-description">
              Role-based authentication and authorization ensuring 
              secure access to sensitive laboratory data.
            </p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">📱</div>
            <h3 class="feature-title">Modern Interface</h3>
            <p class="feature-description">
              Responsive design with intuitive user interface 
              optimized for desktop and mobile devices.
            </p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">🔄</div>
            <h3 class="feature-title">Transaction Management</h3>
            <p class="feature-description">
              Complete transaction tracking for transfers, requests, 
              and inventory movements with audit trails.
            </p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h3 class="feature-title">Real-time Updates</h3>
            <p class="feature-description">
              Live notifications and real-time synchronization 
              across all connected devices and users.
            </p>
          </div>
        </section>
        
        <footer class="footer" id="contact">
          <p>&copy; 2025 JITS Pharmacy. All rights reserved. | Chemical Stock Management API v1.0</p>
        </footer>
      </main>
    </body>
    </html>
  `);
});

// Mount Routes
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
app.use('/api/courses', require('./routes/courseRoutes'));
app.use('/api/subjects', require('./routes/subjectRoutes'));
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
app.use('/api/sync', require('./routes/syncRoutes')); // Add sync routes for chemical-product integration
app.use('/api/labs', require('./routes/labRoutes')); // Add lab management routes
app.use('/api/requirements', require('./routes/requirementRoutes')); // Add requirement management routes

// Error Handler
app.use(errorHandler);

// Run expiry alerts
// checkForExpiringChemicals();

// Start server with keep-alive fixes
const PORT = process.env.PORT || 7000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Fix timeouts for long requests
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
