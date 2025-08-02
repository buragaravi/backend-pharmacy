# Request Date Validation API Documentation

## Overview
This document describes the enhanced request allocation system with date-based validation and smart allocation controls.

## Key Features
1. **Date-based Allocation Control**: Allocation is only allowed within experiment date range
2. **Admin Grace Period**: Admins can allocate up to 2 days after experiment date
3. **Admin Override**: Admins can explicitly override date restrictions
4. **Smart Re-allocation**: Previously disabled items can be re-allocated if re-enabled
5. **Edit Permissions**: Intelligent editing controls based on allocation status and dates

## New API Endpoints

### 1. Get Request Allocation Status
**GET** `/api/requests/:id/allocation-status`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "requestId": "request_id",
  "requestStatus": "approved",
  "faculty": {
    "id": "faculty_id",
    "name": "Faculty Name",
    "email": "faculty@email.com"
  },
  "labId": "LAB001",
  "overallStatus": {
    "canAllocateAny": true,
    "totalExperiments": 2,
    "allocatableExperiments": 1,
    "dateExpiredExperiments": 1,
    "fullyAllocatedExperiments": 0
  },
  "experimentStatuses": [
    {
      "experimentId": "exp_id",
      "experimentName": "Chemistry Lab 1",
      "date": "2025-08-05T00:00:00.000Z",
      "canAllocate": true,
      "reasonType": "allocatable",
      "pendingItems": 5,
      "reenabledItems": 2,
      "daysRemaining": 4,
      "itemBreakdown": {
        "chemicals": {
          "total": 3,
          "allocated": 1,
          "disabled": 0,
          "pending": 2,
          "reenabled": 1
        },
        "glassware": {
          "total": 2,
          "allocated": 0,
          "disabled": 0,
          "pending": 2,
          "reenabled": 0
        },
        "equipment": {
          "total": 1,
          "allocated": 0,
          "disabled": 0,
          "pending": 1,
          "reenabled": 1
        }
      }
    }
  ],
  "lastUpdated": "2025-08-01T10:30:00.000Z"
}
```

### 2. Set Admin Override
**POST** `/api/requests/:id/experiments/:experimentId/admin-override`

**Headers:**
```
Authorization: Bearer <admin_token>
```

**Body:**
```json
{
  "reason": "Emergency lab requirement - approved by department head",
  "enable": true
}
```

**Response:**
```json
{
  "message": "Admin override enabled successfully",
  "experiment": {
    "id": "exp_id",
    "name": "Chemistry Lab 1",
    "date": "2025-07-25T00:00:00.000Z",
    "adminOverride": true,
    "overrideReason": "Emergency lab requirement - approved by department head",
    "overrideBy": "admin_id",
    "overrideAt": "2025-08-01T10:30:00.000Z"
  }
}
```

### 3. Get Item Edit Permissions
**GET** `/api/requests/:id/edit-permissions`

**Headers:**
```
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "requestId": "request_id",
  "requestStatus": "approved",
  "experimentsPermissions": [
    {
      "experimentId": "exp_id",
      "experimentName": "Chemistry Lab 1",
      "date": "2025-08-05T00:00:00.000Z",
      "dateStatus": {
        "allowed": true,
        "reason": null,
        "daysRemaining": 4
      },
      "adminOverride": false,
      "items": {
        "chemicals": [
          {
            "itemId": "chem_id",
            "name": "Sodium Chloride",
            "currentQuantity": 100,
            "isAllocated": false,
            "isDisabled": false,
            "wasDisabled": false,
            "permissions": {
              "canEdit": true,
              "canIncrease": false,
              "canDisable": true,
              "canEnable": false,
              "maxIncrease": 0,
              "reason": null
            }
          }
        ],
        "glassware": [...],
        "equipment": [...]
      }
    }
  ],
  "lastUpdated": "2025-08-01T10:30:00.000Z"
}
```

### 4. Update Item Disabled Status
**PUT** `/api/requests/:id/items/disable-status`

**Headers:**
```
Authorization: Bearer <admin_token>
```

**Body:**
```json
{
  "updates": [
    {
      "experimentId": "exp_id",
      "itemType": "chemicals",
      "itemId": "chem_id",
      "isDisabled": true,
      "reason": "Out of stock temporarily"
    },
    {
      "experimentId": "exp_id",
      "itemType": "equipment",
      "itemId": "equip_id",
      "isDisabled": false,
      "reason": ""
    }
  ]
}
```

**Response:**
```json
{
  "message": "Successfully processed 2 updates",
  "processedUpdates": [
    {
      "experimentId": "exp_id",
      "experimentName": "Chemistry Lab 1",
      "itemType": "chemicals",
      "itemId": "chem_id",
      "itemName": "Sodium Chloride",
      "oldStatus": {
        "isDisabled": false,
        "disabledReason": ""
      },
      "newStatus": {
        "isDisabled": true,
        "disabledReason": "Out of stock temporarily"
      },
      "action": "disabled"
    }
  ],
  "totalProcessed": 2,
  "totalErrors": 0
}
```

## Enhanced Existing Endpoints

### 1. Allocate Resources (Enhanced)
**PUT** `/api/requests/:id/allocate-unified`

Now includes automatic date validation before allocation.

**Error Response for Date Violations:**
```json
{
  "message": "Cannot allocate - experiment date restrictions",
  "errors": [
    "Experiment \"Chemistry Lab 1\": Experiment date (07/25/2025) expired beyond grace period (7 days overdue)"
  ],
  "warnings": [
    "Experiment \"Physics Lab\": Experiment date (07/30/2025) expired - Admin access available (1 days overdue)"
  ],
  "experimentStatuses": [...],
  "code": "DATE_VALIDATION_FAILED"
}
```

### 2. Admin Edit Request (Enhanced)
**PUT** `/api/requests/:id/admin-edit`

Now includes date validation and prevents editing of allocated items.

**Error Response for Edit Violations:**
```json
{
  "message": "Cannot edit - experiment date restrictions",
  "dateValidationErrors": [
    {
      "experimentId": "exp_id",
      "experimentName": "Chemistry Lab 1",
      "date": "2025-07-25T00:00:00.000Z",
      "error": "Experiment \"Chemistry Lab 1\" date expired beyond grace period (7 days overdue)"
    }
  ],
  "code": "DATE_VALIDATION_FAILED"
}
```

## Date Validation Rules

### 1. Standard Users (Faculty, Lab Assistant)
- **Allowed**: Before or on experiment date
- **Blocked**: After experiment date

### 2. Admin Users
- **Allowed**: Before or on experiment date
- **Grace Period**: Up to 2 days after experiment date
- **Blocked**: More than 2 days after experiment date (unless override is set)

### 3. Admin Override
- **Purpose**: Allow allocation even after grace period expires
- **Requirements**: Must provide reason
- **Scope**: Per experiment
- **Tracking**: Records who set override and when

## Item Edit Rules

### 1. Non-Allocated Items
- **Edit Quantity**: Allowed (within date restrictions)
- **Disable**: Allowed (within date restrictions)
- **Enable**: Allowed (within date restrictions)

### 2. Allocated Items
- **Edit Quantity**: Only increases allowed (within inventory limits)
- **Disable**: Not allowed
- **Enable**: N/A (already allocated)

### 3. Disabled Items
- **Edit Quantity**: Allowed (within date restrictions)
- **Enable**: Allowed (within date restrictions)
- **Track History**: `wasDisabled` flag set when re-enabled

## Status Calculation Logic

The system uses intelligent status calculation:

1. **fulfilled**: All items are allocated
2. **partially_fulfilled**: Some items allocated, others pending or disabled
3. **approved**: No items allocated yet, but allocation is possible

The status considers:
- Date restrictions
- Disabled items
- Admin overrides
- Re-enabled items

## Error Codes

- `INVALID_REQUEST_ID`: Request ID format is invalid
- `REQUEST_NOT_FOUND`: Request does not exist
- `EXPERIMENT_NOT_FOUND`: Experiment not found in request
- `DATE_EXPIRED_COMPLETELY`: Date expired beyond all access
- `DATE_EXPIRED_ADMIN_ONLY`: Date expired, admin access available
- `DATE_VALIDATION_FAILED`: Multiple date violations
- `EDIT_PERMISSION_VIOLATIONS`: Edit validation failed
- `OVERRIDE_NOT_NEEDED`: Admin override not required
- `ACCESS_DENIED`: Insufficient permissions
