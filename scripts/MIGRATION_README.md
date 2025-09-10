# Central Lab to Central Store Migration

This directory contains scripts to migrate all inventory items from `labId: "central-lab"` to `labId: "central-store"`.

## Migration Scripts

### 1. Quick Migration (Recommended)
```bash
# Navigate to backend directory
cd backend-Pydah

# Run the migration script
node scripts/migrateCentralLab.js
```

This script will:
- ✅ Connect to your MongoDB database
- 🔍 Find all documents with `labId: "central-lab"` across all inventory types
- 📝 Show you what will be updated
- 🔄 Update all found documents to `labId: "central-store"`
- ✅ Verify the migration was successful

### 2. API Endpoint Migration
If you prefer to run the migration through the API:

```bash
# POST request to your running server
curl -X POST http://localhost:7000/api/sync/migrate-central-lab-to-store \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### 3. Detailed Migration Scripts
For more detailed logging and control:

```bash
# Chemical inventory only
node scripts/migrateCentralLabToStore.js

# All inventory types with detailed logging
node scripts/migrateAllInventoryCentralLabToStore.js
```

## What Gets Updated

The migration affects these inventory models:
- **ChemicalLive** - Chemical inventory items
- **EquipmentLive** - Equipment inventory items  
- **GlasswareLive** - Glassware inventory items
- **OtherProductLive** - Other product inventory items

## Safety Features

All scripts include:
- 🔍 **Preview mode** - Shows what will be updated before making changes
- ✅ **Verification** - Confirms migration success
- 📊 **Detailed logging** - Shows exactly what happened
- 🔄 **Rollback safe** - Can be run multiple times safely

## Before Running

1. **Backup your database** (recommended)
2. **Verify your connection string** in `.env` file
3. **Test on staging environment** first (if available)

## After Migration

The migration will update:
- All inventory items with `labId: "central-lab"` → `labId: "central-store"`
- No other data is affected
- All relationships and references remain intact

## Verification

After running, you can verify the migration worked by:

1. **Check the script output** - it shows counts before/after
2. **Query your database directly**:
   ```javascript
   // Should return 0
   db.chemicallives.countDocuments({ labId: "central-lab" })
   
   // Should show your migrated items
   db.chemicallives.countDocuments({ labId: "central-store" })
   ```

3. **Use the admin panel** - inventory should now show "central-store" instead of "central-lab"

## Troubleshooting

- **"Connection failed"** - Check your MongoDB connection string in `.env`
- **"No documents found"** - Your inventory might already be using "central-store"
- **"Permission denied"** - For API endpoint, ensure you're using an admin token
- **"Model not found"** - Ensure you're running from the `backend-Pydah` directory

## Need Help?

If you encounter any issues:
1. Check the console output for specific error messages
2. Verify your database connection
3. Ensure all required models exist in your database
4. Contact your development team if needed
