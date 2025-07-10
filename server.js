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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization']
};

app.use(cors(corsOptions));

// Body parser
app.use(express.json());

// Swagger docs
require('./swagger')(app);

// Futuristic landing route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Chemical Stock Management</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          height: 100%;
          background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
          font-family: 'Orbitron', sans-serif;
          overflow: hidden;
          cursor: none;
        }
        canvas {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 0;
        }
        .content {
          position: relative;
          z-index: 1;
          display: flex;
          height: 100%;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          color: #fff;
        }
        h1 {
          font-size: 3rem;
          letter-spacing: 2px;
          text-shadow: 0 0 20px #00f5ff;
          transition: transform 0.3s ease-in-out;
        }
        h1:hover {
          transform: scale(1.05);
        }
        .btn {
          margin-top: 30px;
          padding: 15px 30px;
          background: #00f5ff;
          color: #000;
          border: none;
          font-weight: bold;
          font-size: 1rem;
          border-radius: 10px;
          box-shadow: 0 0 20px #00f5ff;
          transition: all 0.3s ease;
        }
        .btn:hover {
          background: #0ff;
          transform: scale(1.1);
          box-shadow: 0 0 30px #00f5ff;
        }
        .cursor {
          position: absolute;
          width: 30px;
          height: 30px;
          border: 2px solid #00f5ff;
          border-radius: 50%;
          pointer-events: none;
          transition: transform 0.2s ease;
          z-index: 1000;
        }
      </style>
    </head>
    <body>
      <div class="cursor" id="cursor"></div>
      <div class="content">
        <h1>🔬 Advanced Chemical Stock Management</h1>
        <button class="btn">Explore System Features</button>
      </div>
      <canvas id="particles"></canvas>
      <script>
        // Custom cursor
        const cursor = document.getElementById('cursor');
        document.addEventListener('mousemove', e => {
          cursor.style.left = e.pageX + 'px';
          cursor.style.top = e.pageY + 'px';
        });

        // Animated particles
        const canvas = document.getElementById('particles');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        for (let i = 0; i < 100; i++) {
          particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 3 + 1,
            dx: (Math.random() - 0.5) * 2,
            dy: (Math.random() - 0.5) * 2,
          });
        }

        function animate() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (let p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = '#00f5ff';
            ctx.fill();
            p.x += p.dx;
            p.y += p.dy;
            if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
          }
          requestAnimationFrame(animate);
        }
        animate();
      </script>
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

// Error Handler
app.use(errorHandler);

// Run expiry alerts
checkForExpiringChemicals();

// Start server with keep-alive fixes
const PORT = process.env.PORT || 7000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Fix timeouts for long requests
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
