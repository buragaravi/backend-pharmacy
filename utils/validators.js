// Constants 
const validateVendorInput = (data) => {
  const errors = {};
  
  // Required fields validation
  if (!data.name || data.name.trim() === '') {
    errors.name = 'Vendor name is required';
  }
  
  if (!data.email || data.email.trim() === '') {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Invalid email format';
  }
  
  if (!data.phone || data.phone.trim() === '') {
    errors.phone = 'Phone number is required';
  } else if (!/^\+?[\d\s-]{10,}$/.test(data.phone)) {
    errors.phone = 'Invalid phone number format (minimum 10 digits)';
  }
  
  // Address validation - at least city and state are required
  if (!data.address || 
      (!data.address.city || data.address.city.trim() === '') ||
      (!data.address.state || data.address.state.trim() === '')) {
    errors.address = 'City and State are required in address';
  }
  
  // Optional fields validation
  if (data.website && !/^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(data.website)) {
    errors.website = 'Invalid website URL format';
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