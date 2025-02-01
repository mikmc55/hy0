# Use Node.js LTS as the base image
FROM node:16

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy application files, including models, into the container
COPY . .

# Set appropriate permissions for the copied files
# This ensures that files in the container are accessible and writable
RUN chmod -R 755 /usr/src/app && \
    chown -R node:node /usr/src/app

# Create logs directory and set appropriate permissions
RUN mkdir /usr/src/app/logs && \
    chmod -R 777 /usr/src/app/logs

# Expose the application port
EXPOSE 3001

# Use a non-root user to run the application
USER node

# Define the default command to start the app
CMD ["npm", "start"]
