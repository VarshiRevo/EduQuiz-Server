# Use the official Node.js image as the base image
FROM node:18

# Install required packages (OpenJDK, GCC, etc.)
RUN apt-get update && apt-get install -y \
    openjdk-11-jdk \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 5000

# Start the server
CMD ["npm", "start"]
