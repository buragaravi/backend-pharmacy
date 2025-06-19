const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Pharmacy Stocks API',
      version: '1.0.0',
      description: 'API documentation for Pharmacy Stocks system',
    },
  },
  apis: ['./routes/*.js', './models/*.js'], // Adjust as needed
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
};
