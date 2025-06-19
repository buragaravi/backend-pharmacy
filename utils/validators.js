// Constants 
const validateVendorInput = (data) => {
  const errors = {};
  
  if (!data.name || data.name.trim() === '') {
    errors.name = 'Vendor name is required';
  }
  
  if (data.phone && !/^\+?[\d\s-]{10,}$/.test(data.phone)) {
    errors.phone = 'Invalid phone number format';
  }
  
  if (data.website && !/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(data.website)) {
    errors.website = 'Invalid website URL';
  }
  
  if (data.description && data.description.length > 500) {
    errors.description = 'Description cannot exceed 500 characters';
  }
  
  return {
    errors,
    valid: Object.keys(errors).length === 0
  };
};

module.exports = {
  validateVendorInput
};