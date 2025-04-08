FROM node:20-slim

LABEL maintainer="Kirell Benzi"
LABEL version="19.2.3"
LABEL description="Docker file for SocketCluster with support for clustering and admin dashboard."

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Expose port for app
EXPOSE 8000

# Set environment variables
ENV NODE_ENV=production
ENV SOCKETCLUSTER_LOG_LEVEL=2

# Start the application
CMD ["node", "server.js"]
