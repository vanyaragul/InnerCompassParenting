# Use the official Node.js LTS image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the port that the app runs on
EXPOSE $PORT

# Start the application
CMD ["node", "stripe-server.js"]