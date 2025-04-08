FROM node:20-slim

LABEL maintainer="Kirell Benzi"
LABEL version="19.2.3"
LABEL description="Docker file for SocketCluster with support for clustering and admin dashboard."

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# Copy package.json and package-lock.json first for better layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Expose port for app
EXPOSE 8000

# Set environment variables
ENV NODE_ENV=production
ENV SOCKETCLUSTER_LOG_LEVEL=2

# Start the application
CMD ["npm", "run", "start:docker"]
