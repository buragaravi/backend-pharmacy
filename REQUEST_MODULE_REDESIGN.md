# Unified Request Module Redesign

_Last updated: 2025-06-09_

This document outlines the new unified request process for Chemicals, Equipment, and Glassware, including user flow, data structure, and implementation plan.

---

## 1. Goal
- Allow users to request chemicals, equipment, and glassware for experiments in a single, unified form.
- For each experiment, requests for chemicals, equipment, and glassware are tracked and processed separately.
- Equipment allocation is by unique item IDs (not just quantity).
- Chemicals and glassware allocation remains by quantity.
- No changes or side effects to other modules.

---

## 2. User Flow

### A. Request Creation (Faculty/Lab User)
- User selects the experiment (or creates a new one).
- For each experiment, user can add:
  - **Chemicals:** Select chemical, specify quantity/unit.
  - **Equipment:** Select equipment type, specify quantity needed. For each unit, select/enter a unique itemId.
  - **Glassware:** Select glassware type, specify quantity/unit.
- For equipment, if quantity > 1, user must provide the required number of unique item IDs for that equipment type.
- User submits the request.

### B. Request Data Structure
```json
{
  "experimentId": "EXP123",
  "requestedBy": "userId",
  "labId": "LAB01",
  "chemicals": [
    { "chemicalId": "CHEM123", "quantity": 5, "unit": "g" }
  ],
  "equipment": [
    { "equipmentTypeId": "EQUIPTYPE123", "itemIds": ["EQUIP001", "EQUIP002"] }
  ],
  "glassware": [
    { "glasswareId": "GLASS123", "quantity": 10, "unit": "pcs" }
  ],
  "remarks": "For titration experiment"
}
```

---

## 3. Backend/API Changes
- **POST `/api/requests`**
  - Accepts the above unified structure.
- **Allocation endpoints** remain the same for chemicals and glassware (by quantity).
- **Equipment allocation** endpoint expects an array of itemIds for each equipment type.

---

## 4. Frontend Implementation Plan

### A. Unified Request Form
- **Step 1:** Select experiment.
- **Step 2:** For each category (Chemicals, Equipment, Glassware):
  - User can add multiple items.
  - For equipment, after selecting type and quantity, prompt user to select/enter the required number of itemIds.
- **Step 3:** Review and submit.

### B. Dynamic Fields
- Show/hide fields based on category selection (chemical/equipment/glassware).
- For equipment, dynamically generate itemId fields based on quantity.

### C. Data Submission
- On submit, structure the data as shown above and send to backend.

---

## 5. Processing & Allocation
- **Chemicals/Glassware:**
  - Allocated by quantity as before.
- **Equipment:**
  - Allocated by unique itemIds.
  - If user requests 2 units of a microscope, they must specify 2 available itemIds for microscopes.
- **Status Tracking:**
  - Each category (chemicals, equipment, glassware) can be tracked and fulfilled independently.

---

## 6. User Rights
- **Faculty/Lab User:** Can create requests.
- **Inventory Manager/Admin:** Can review, approve, and allocate items per category.

---

## 7. No Side Effects
- No changes to allocation logic for chemicals or glassware.
- Equipment allocation logic is extended to handle multiple itemIds per request.

---

## 8. Implementation Steps
1. **Design the unified request form UI.**
2. **Implement dynamic item addition for each category.**
3. **For equipment, implement itemId selection based on quantity.**
4. **Update backend to accept and process the unified request structure.**
5. **Test end-to-end for all categories and edge cases.**

---

**This document should be referenced by all developers working on the request module redesign.**
