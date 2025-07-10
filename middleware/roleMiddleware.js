// Middleware: Role-based Access 
// Middleware for role-based access control
const authorizeRole = (roles) => {
    return (req, res, next) => {
      // Convert single role to array for consistent handling
      const allowedRoles = Array.isArray(roles) ? roles : [roles];
      
      console.log('Role Debug - URL:', req.originalUrl);
      console.log('Role Debug - User role:', req.user?.role);
      console.log('Role Debug - Allowed roles:', allowedRoles);
      
      // Check if the user has the required role
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        console.log('Role Debug - Access denied for role:', req.user?.role);
        return res.status(403).json({ message: 'Forbidden: You do not have access to this resource.' });
      }
      
      console.log('Role Debug - Access granted for role:', req.user.role);
      next(); // Allow the request to proceed
    };
  };
  
  module.exports = authorizeRole;
  