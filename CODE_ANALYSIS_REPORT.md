# Project Code Analysis Report

This document provides a comprehensive, file-by-file analysis of the backend controllers in the `pharmacy-backend` project. Each section summarizes the purpose, key features, and patterns of each file.

---

## controllers/analyticsController.js
- **Purpose:** Provides analytics endpoints for the system, including system overview, chemical analytics, lab analytics, faculty analytics, and predictive analytics.
- **Key Features:**
  - Role-based access control for each endpoint.
  - Aggregates data from multiple collections (chemicals, transactions, requests, quotations).
  - Provides time-based analytics (today, week, month, year, last 30/90 days).
  - Returns metrics such as stock levels, consumption rates, transaction history, expiry data, lab inventory, request stats, chemical usage, top chemicals, department comparisons, consumption trends, and upcoming expirations.
  - Uses MongoDB aggregation pipelines for complex analytics.
  - Supports predictive analytics for forecasting consumption and expirations.

---

## controllers/authController.js
- **Purpose:** Handles all authentication-related logic, including registration, login, user info, and password reset (with OTP via email).
- **Key Features:**
  - User registration with validation, password hashing, and unique lab ID enforcement for lab assistants.
  - Login with JWT issuance and last login update.
  - Password reset via OTP (Brevo/Sendinblue), with in-memory OTP storage and verification.
  - Security best practices: bcrypt for hashing, JWT for authentication.

---

## controllers/ChemicalController.js
- **Purpose:** Manages all chemical-related operations, including adding chemicals, batch management, stock/out-of-stock handling, and transaction logging.
- **Key Features:**
  - Helpers for batch ID generation, out-of-stock management, and reindexing.
  - Add/update chemicals to Central Store , handling naming, expiry, and batch conflicts.
  - FIFO allocation to labs with transaction safety.
  - Transaction logging for all chemical movements.

---

## controllers/equipmentController.js
- **Purpose:** Manages all equipment-related operations, including registration, allocation, QR code management, stock checks, and audit logging.
- **Key Features:**
  - Batch and QR code management for equipment.
  - Registration and allocation (central to lab, lab to faculty, by QR scan).
  - Return and status management, with audit and transaction logs.
  - Stock check and reporting features.

---

## controllers/experimentController.js
- **Purpose:** Manages all experiment-related operations, including creation, update, retrieval, deletion, and usage analytics.
- **Key Features:**
  - CRUD for experiments.
  - Analytics for average chemical usage per experiment.
  - Suggests chemicals based on historical usage.

---

## controllers/glasswareController.js
- **Purpose:** Manages all glassware-related operations, including registration, allocation, QR code management, and stock retrieval.
- **Key Features:**
  - Batch and QR code management for glassware.
  - Registration and allocation (central to lab, lab to faculty).
  - Stock and availability endpoints.

---

## controllers/indentController.js
- **Purpose:** Manages all indent (requisition/order) operations for chemicals, including creation, approval, allocation, comments, and status management.
- **Key Features:**
  - Indent creation and workflow for lab assistants and Central Store Admins.
  - Comments, remarks, and batch updates.
  - Transactional allocation and approval logic.

---

## controllers/inventoryController.js
- **Purpose:** Manages inventory operations for chemicals, including listing, adding, allocating, and retrieving live stock.
- **Key Features:**
  - Inventory listing and pagination.
  - Add and allocate chemicals, with transaction logging.

---

## controllers/invoiceController.js
- **Purpose:** Manages all invoice-related operations for chemicals, glassware, equipment, and other products, including creation, enrichment, and post-processing.
- **Key Features:**
  - Invoice creation for all product types.
  - Post-processing to add items to inventory and increment voucher IDs.

---

## controllers/notificationController.js
- **Purpose:** Manages user notifications, including creation, marking as read, and retrieval with pagination.
- **Key Features:**
  - Notification creation, status update, and paginated retrieval.

---

## controllers/otherProductController.js
- **Purpose:** Manages all "other product" operations, including registration, allocation, QR code management, and stock retrieval.
- **Key Features:**
  - Batch and QR code management for other products.
  - Registration and allocation (central to lab, lab to faculty).
  - Stock and availability endpoints.

---

## controllers/productController.js
- **Purpose:** Manages all product-related operations, including CRUD and search for chemicals, glassware, equipment, and other products.
- **Key Features:**
  - Product listing, creation, update, deletion, and search.
  - Category-based validation and logic.

---

## controllers/quotationController.js
- **Purpose:** Manages all quotation-related operations for chemicals, including creation, approval, allocation, comments, and status management.
- **Key Features:**
  - Quotation creation and workflow for lab assistants and Central Store Admins.
  - Comments, remarks, and batch updates.
  - Transactional allocation and approval logic.

---

*This report covers the backend controllers. For a similar analysis of models, routes, middleware, or frontend files, please request the next section.*
