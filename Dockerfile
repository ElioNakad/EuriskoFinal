# Base image
FROM node:20

# Create app folder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy everything
COPY . .

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "run", "start:dev"]