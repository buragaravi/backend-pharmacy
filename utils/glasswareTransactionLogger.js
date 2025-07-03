const fs = require('fs');
const path = require('path');
const GlasswareTransaction = require('../models/GlasswareTransaction');

/**
 * Log glassware transaction to file and database
 * @param {Object} transactionData - Transaction data to log
 */
exports.logGlasswareTransaction = async (transactionData) => {
  try {
    // Create log message
    const logMessage = `Date: ${transactionData.date}, Glassware ID: ${transactionData.glasswareLiveId}, Name: ${transactionData.glasswareName}, Type: ${transactionData.transactionType}, Quantity: ${transactionData.quantity}, Variant: ${transactionData.variant}, From Lab: ${transactionData.fromLabId || 'N/A'}, To Lab: ${transactionData.toLabId || 'N/A'}, Condition: ${transactionData.condition}, Reason: ${transactionData.reason || 'N/A'}, Created By: ${transactionData.createdBy}\n`;
    
    // Define log file path
    const logFilePath = path.join(__dirname, '..', 'logs', 'glassware-transactions.log');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(path.dirname(logFilePath))) {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    }

    // Append to log file
    fs.appendFileSync(logFilePath, logMessage);
    
    console.log('Glassware transaction logged successfully');
  } catch (error) {
    console.error('Error logging glassware transaction:', error.message);
  }
};

/**
 * Log condition change for glassware
 * @param {Object} conditionData - Condition change data
 */
exports.logConditionChange = async (conditionData) => {
  try {
    const logMessage = `Date: ${conditionData.date}, Glassware ID: ${conditionData.glasswareLiveId}, Name: ${conditionData.glasswareName}, Previous Condition: ${conditionData.previousCondition}, New Condition: ${conditionData.newCondition}, Reason: ${conditionData.reason || 'N/A'}, Changed By: ${conditionData.changedBy}\n`;
    
    const logFilePath = path.join(__dirname, '..', 'logs', 'glassware-condition-changes.log');
    
    if (!fs.existsSync(path.dirname(logFilePath))) {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    }

    fs.appendFileSync(logFilePath, logMessage);
    
    console.log('Glassware condition change logged successfully');
  } catch (error) {
    console.error('Error logging glassware condition change:', error.message);
  }
};

/**
 * Log maintenance activity
 * @param {Object} maintenanceData - Maintenance activity data
 */
exports.logMaintenanceActivity = async (maintenanceData) => {
  try {
    const logMessage = `Date: ${maintenanceData.date}, Glassware ID: ${maintenanceData.glasswareLiveId}, Name: ${maintenanceData.glasswareName}, Activity: ${maintenanceData.activity}, Description: ${maintenanceData.description || 'N/A'}, Status: ${maintenanceData.status}, Performed By: ${maintenanceData.performedBy}\n`;
    
    const logFilePath = path.join(__dirname, '..', 'logs', 'glassware-maintenance.log');
    
    if (!fs.existsSync(path.dirname(logFilePath))) {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    }

    fs.appendFileSync(logFilePath, logMessage);
    
    console.log('Glassware maintenance activity logged successfully');
  } catch (error) {
    console.error('Error logging glassware maintenance activity:', error.message);
  }
};

/**
 * Get transaction logs for analysis
 * @param {Object} filters - Filter criteria
 * @returns {Array} Array of log entries
 */
exports.getTransactionLogs = async (filters = {}) => {
  try {
    const { startDate, endDate, transactionType, labId } = filters;
    
    let query = {};
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    if (transactionType) {
      query.transactionType = transactionType;
    }
    
    if (labId) {
      query.$or = [
        { fromLabId: labId },
        { toLabId: labId }
      ];
    }
    
    const logs = await GlasswareTransaction.find(query)
      .populate('glasswareLiveId', 'name variant')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    return logs;
  } catch (error) {
    console.error('Error fetching transaction logs:', error.message);
    return [];
  }
};

/**
 * Archive old transaction logs
 * @param {number} daysToKeep - Number of days to keep logs
 */
exports.archiveOldLogs = async (daysToKeep = 365) => {
  try {
    const archiveDate = new Date();
    archiveDate.setDate(archiveDate.getDate() - daysToKeep);
    
    // Move old logs to archive
    const logFilePath = path.join(__dirname, '..', 'logs', 'glassware-transactions.log');
    const archiveFilePath = path.join(__dirname, '..', 'logs', 'archived', `glassware-transactions-${archiveDate.toISOString().split('T')[0]}.log`);
    
    if (fs.existsSync(logFilePath)) {
      // Create archive directory if it doesn't exist
      if (!fs.existsSync(path.dirname(archiveFilePath))) {
        fs.mkdirSync(path.dirname(archiveFilePath), { recursive: true });
      }
      
      // Read current log file
      const logContent = fs.readFileSync(logFilePath, 'utf8');
      const logLines = logContent.split('\n');
      
      // Separate old and new logs
      const newLogs = [];
      const oldLogs = [];
      
      logLines.forEach(line => {
        if (line.trim()) {
          const dateMatch = line.match(/Date: ([^,]+)/);
          if (dateMatch) {
            const logDate = new Date(dateMatch[1]);
            if (logDate < archiveDate) {
              oldLogs.push(line);
            } else {
              newLogs.push(line);
            }
          } else {
            newLogs.push(line);
          }
        }
      });
      
      // Write old logs to archive
      if (oldLogs.length > 0) {
        fs.writeFileSync(archiveFilePath, oldLogs.join('\n') + '\n');
      }
      
      // Write new logs back to main file
      fs.writeFileSync(logFilePath, newLogs.join('\n') + '\n');
      
      console.log(`Archived ${oldLogs.length} old log entries`);
    }
  } catch (error) {
    console.error('Error archiving old logs:', error.message);
  }
};
