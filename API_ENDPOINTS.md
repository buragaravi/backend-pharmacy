# Laboratory Inventory System Backend API Documentation

_Last updated: 2025-06-09_

This document describes all backend API endpoints for **Authentication**, **Equipment**, **Chemicals**, and **Glassware** in the laboratory inventory system. For each endpoint, you will find:
- **Purpose**
- **Method & URL**
- **Request format**
- **Response format**
- **Authentication/Authorization requirements**

---

## Authentication Endpoints (`/api/auth`)

### Register
- **POST** `/api/auth/register`
- **Purpose:** Register a new user (admin, lab assistant, etc.).
- **Request:**
  ```json
  { "userId": "...", "name": "...", "email": "...", "password": "...", "role": "lab_assistant"|"admin"|..., "labId": "LAB01" }
  ```
- **Response:**
  ```json
  { "msg": "User registered successfully" }
  ```
- **Auth:** Public

### Login
- **POST** `/api/auth/login`
- **Purpose:** Authenticate user and receive JWT token.
- **Request:**
  ```json
  { "email": "...", "password": "..." }
  ```
- **Response:**
  ```json
  { "token": "...", "user": { "userId": "...", "role": "..." } }
  ```
- **Auth:** Public

### Get Current User
- **GET** `/api/auth/me`
- **Purpose:** Get info for the currently authenticated user.
- **Response:**
  ```json
  { "userId": "...", "name": "...", "email": "...", "role": "...", ... }
  ```
- **Auth:** JWT required

### Request Password Reset (Send OTP)
- **POST** `/api/auth/request-password-reset`
- **Purpose:** Request a password reset OTP to be sent to the user's email.
- **Request:**
  ```json
  { "email": "..." }
  ```
- **Response:**
  ```json
  { "msg": "OTP sent to your registered email address" }
  ```
- **Auth:** Public

### Verify OTP
- **POST** `/api/auth/verify-otp`
- **Purpose:** Verify OTP for password reset.
- **Request:**
  ```json
  { "email": "...", "otp": "123456" }
  ```
- **Response:**
  ```json
  { "msg": "OTP verified successfully", "token": "temp_token_for_reset" }
  ```
- **Auth:** Public

### Reset Password
- **POST** `/api/auth/reset-password`
- **Purpose:** Reset password after OTP verification.
- **Request:**
  ```json
  { "email": "...", "newPassword": "..." }
  ```
- **Response:**
  ```json
  { "msg": "Password updated successfully" }
  ```
- **Auth:** Public (OTP verification required)

---

## Equipment Endpoints (`/api/equipment`)

### Add Equipment to Central Store
- **POST** `/api/equipment/central/add`
- **Purpose:** Add new equipment items to the central store after invoice.
- **Request:**
  ```json
  {
    "items": [
      { "productId": "...", "name": "...", "variant": "...", "quantity": 1, "vendor": "...", "pricePerUnit": 0, "department": "...", "unit": "...", "expiryDate": "2025-12-31", "warranty": "", "maintenanceCycle": "" }
    ],
    "usePreviousBatchId": false,
    "userId": "...", // optional
    "userRole": "..." // optional
  }
  ```
- **Response:**
  ```json
  { "message": "Equipment items registered successfully", "batchId": "...", "items": [ ... ], "qrCodes": [ { "itemId": "...", "qrCodeImage": "base64..." } ] }
  ```
- **Auth:** Admin or Central Lab Admin (JWT required)

### Allocate Equipment to Lab
- **POST** `/api/equipment/allocate/lab`
- **Purpose:** Allocate equipment from central to a lab (FIFO, expiry-aware).
- **Request:**
  ```json
  { "productId": "...", "variant": "...", "quantity": 1, "toLabId": "LAB01" }
  ```
- **Response:**
  ```json
  { "message": "Equipment allocated to lab", "allocated": 1 }
  ```
- **Auth:** Admin or Central Lab Admin (JWT required)

### Allocate Equipment to Faculty
- **POST** `/api/equipment/allocate/faculty`
- **Purpose:** Allocate equipment from lab to faculty.
- **Request:**
  ```json
  { "productId": "...", "variant": "...", "quantity": 1, "fromLabId": "LAB01" }
  ```
- **Response:**
  ```json
  { "message": "Equipment allocated to faculty" }
  ```
- **Auth:** Lab Assistant or above (JWT required)

### Get Equipment Stock
- **GET** `/api/equipment/stock?labId=LAB01`
- **Purpose:** Get equipment stock for central or a specific lab.
- **Response:** Array of equipment items.
- **Auth:** Any authenticated user

### Get Central Available Equipment
- **GET** `/api/equipment/central/available`
- **Purpose:** List available equipment in central lab for allocation.
- **Response:** Array of available equipment.
- **Auth:** Any authenticated user

### Scan Equipment QR Code
- **POST** `/api/equipment/scan`
- **Purpose:** Scan QR code and get stock/transaction/audit info for an equipment item.
- **Request:**
  ```json
  { "qrCodeData": "..." }
  ```
- **Response:**
  ```json
  { "stock": [...], "transactions": [...], "equipmentTransactions": [...], "equipmentAuditLogs": [...] }
  ```
- **Auth:** Any authenticated user

### Return Equipment to Central
- **POST** `/api/equipment/return/central`
- **Purpose:** Return an equipment item to central by QR scan (itemId).
- **Request:**
  ```json
  { "itemId": "..." }
  ```
- **Response:**
  ```json
  { "message": "Equipment item returned to central", "item": { ... } }
  ```
- **Auth:** Lab Assistant or above (JWT required)

### Allocate Equipment to Lab by Scan
- **POST** `/api/equipment/allocate/scan`
- **Purpose:** Allocate equipment to lab by scanning QR (itemId).
- **Request:**
  ```json
  { "itemId": "...", "toLabId": "LAB01" }
  ```
- **Response:**
  ```json
  { "message": "Equipment item allocated to lab", "item": { ... } }
  ```
- **Auth:** Lab Assistant or above (JWT required)

### Get Full Equipment Trace
- **GET** `/api/equipment/item/:itemId/full-trace`
- **Purpose:** Get full trace (item, transactions, audit logs) for an equipment item.
- **Response:**
  ```json
  { "equipment": { ... }, "transactions": [...], "auditLogs": [...] }
  ```
- **Auth:** Any authenticated user

### Stock Check Endpoints
- **GET** `/api/equipment/stock-check/reports`
- **GET** `/api/equipment/stock-check/report/:id`
- **POST** `/api/equipment/stock-check/report`
- **GET** `/api/equipment/stock-check/reports/month`
- **GET** `/api/equipment/live`
- **Purpose:** Manage and retrieve equipment stock check sessions and reports.
- **Request/Response:** See EquipmentStockCheck model. POST expects:
  ```json
  { "performedBy": "userId", "performedByName": "Name", "lab": "LAB01", "items": [ { "itemId": "...", "status": "Present"|... } ] }
  ```
- **Auth:** Lab Assistant or above (JWT required)

---

## Chemical Endpoints (`/api/chemicals`)

_All routes require authentication (JWT). Role-based restrictions as noted._

### Add Chemicals to Master
- **POST** `/api/chemicals/add`
- **Purpose:** Add new chemicals to master and central live stock.
- **Request:**
  ```json
  { "chemicals": [ { "chemicalName": "...", "quantity": 1, "unit": "g", "expiryDate": "2025-12-31", "vendor": "...", "pricePerUnit": 0, "department": "..." } ], "usePreviousBatchId": false }
  ```
- **Response:**
  ```json
  { "message": "Chemicals added/updated successfully", "batchId": "...", "chemicals": [ ... ] }
  ```
- **Auth:** Admin or Central Lab Admin

### Allocate Chemicals to Lab
- **POST** `/api/chemicals/allocate`
- **Purpose:** Allocate chemicals from central to a lab (FIFO, expiry-aware).
- **Request:**
  ```json
  { "labId": "LAB01", "allocations": [ { "chemicalMasterId": "...", "quantity": 1 } ] }
  ```
- **Response:**
  ```json
  { "message": "All allocations completed successfully", "results": [ { "chemicalName": "...", "status": "success", "allocatedQuantity": 1, "expiryDate": "...", "chemicalMasterId": "..." } ] }
  ```
- **Auth:** Central Lab Admin

### Get Central Master Chemicals
- **GET** `/api/chemicals/master`
- **Purpose:** List all master chemicals in central.
- **Response:** Array of master chemicals.
- **Auth:** Admin or Central Lab Admin

### Get Lab Master Chemicals
- **GET** `/api/chemicals/master/:labId`
- **Purpose:** List all master chemicals for a specific lab.
- **Response:** Array of master chemicals.
- **Auth:** Admin, Central Lab Admin, or Lab Assistant

### Get Live Stock by Lab
- **GET** `/api/chemicals/live/:labId`
- **Purpose:** Get live chemical stock for a lab.
- **Response:** Array of live chemical stock.
- **Auth:** Admin, Central Lab Admin, or Lab Assistant

### Get Central Live Stock (Simplified)
- **GET** `/api/chemicals/central/available`
- **Purpose:** List available chemicals in central for allocation forms.
- **Response:** Array of simplified chemical stock.
- **Auth:** Any authenticated user

### Get Chemical Distribution
- **GET** `/api/chemicals/distribution`
- **Purpose:** Get chemical distribution across labs.
- **Response:** Array of distribution objects.
- **Auth:** Admin, Central Lab Admin, or Lab Assistant

### Expired Chemicals Management
- **GET** `/api/chemicals/expired`
- **Purpose:** List expired chemicals in central lab.
- **Response:** Array of expired chemicals.
- **Auth:** Central Lab Admin

- **POST** `/api/chemicals/expired/action`
- **Purpose:** Process admin action for expired chemical (merge, delete, update_expiry).
- **Request:**
  ```json
  { "chemicalLiveId": "...", "action": "merge"|"delete"|"update_expiry", "mergeToId": "...", "newExpiryDate": "2025-12-31", "reason": "..." }
  ```
- **Response:**
  ```json
  { "message": "..." }
  ```
- **Auth:** Central Lab Admin

### Out-of-Stock Chemicals
- **GET** `/api/chemicals/out-of-stock`
- **Purpose:** List all out-of-stock chemicals.
- **Response:** Array of out-of-stock chemicals.
- **Auth:** Admin, Central Lab Admin, or Lab Assistant

---

## Glassware Endpoints (`/api/glassware`)

### Add Glassware to Central Store
- **POST** `/api/glassware/central/add`
- **Purpose:** Add new glassware items to central after invoice.
- **Request:**
  ```json
  { "items": [ { "productId": "...", "name": "...", "variant": "...", "quantity": 1, "vendor": "...", "pricePerUnit": 0, "department": "..." } ], "usePreviousBatchId": false }
  ```
- **Response:**
  ```json
  { "message": "Glassware added/updated successfully", "batchId": "...", "items": [ ... ], "qrCodes": [ { "productId": "...", "variant": "...", "qrCodeImage": "base64..." } ] }
  ```
- **Auth:** Admin or Central Lab Admin (JWT required)

### Allocate Glassware to Lab
- **POST** `/api/glassware/allocate/lab`
- **Purpose:** Allocate glassware from central to a lab (FIFO, expiry-aware).
- **Request:**
  ```json
  { "labId": "LAB01", "allocations": [ { "glasswareId": "...", "quantity": 1 } ] }
  ```
- **Response:**
  ```json
  { "success": true, "message": "All glassware allocated successfully", "results": [ { "glasswareId": "...", "success": true, "allocated": 1, "message": "Allocation successful" } ] }
  ```
- **Auth:** Admin, Central Lab Admin, or Lab Assistant (JWT required)

### Allocate Glassware to Faculty
- **POST** `/api/glassware/allocate/faculty`
- **Purpose:** Allocate glassware from lab to faculty.
- **Request:**
  ```json
  { "productId": "...", "variant": "...", "quantity": 1, "fromLabId": "LAB01" }
  ```
- **Response:**
  ```json
  { "message": "Glassware allocated to faculty" }
  ```
- **Auth:** Lab Assistant or above (JWT required)

### Get Glassware Stock
- **GET** `/api/glassware/stock?labId=LAB01`
- **Purpose:** Get glassware stock for central or a specific lab.
- **Response:** Array of glassware items.
- **Auth:** Any authenticated user

### Get Central Available Glassware
- **GET** `/api/glassware/central/available`
- **Purpose:** List available glassware in central lab for allocation.
- **Response:** Array of available glassware.
- **Auth:** Any authenticated user

### Scan Glassware QR Code
- **POST** `/api/glassware/scan`
- **Purpose:** Scan QR code and get stock/transaction info for a glassware item.
- **Request:**
  ```json
  { "qrCodeData": "..." }
  ```
- **Response:**
  ```json
  { "stock": [...], "transactions": [...] }
  ```
- **Auth:** Any authenticated user

---

## General Notes
- All endpoints require a valid JWT in the `Authorization: Bearer <token>` header unless otherwise noted.
- Role-based access is enforced for sensitive operations (see above).
- All POST/PUT endpoints expect `Content-Type: application/json`.
- All dates should be in ISO 8601 format (e.g., `2025-12-31`).
- Error responses are always JSON with a `message` field and may include additional details.

---

For further details, see the controller files or contact the backend maintainers.
