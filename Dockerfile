FROM node:20-slim AS builder

WORKDIR /app

# Install necessary build tools for compiling sqlite3 native addon
RUN apt-get update && apt-get install -y python3 build-essential

# Copy package files
COPY package*.json ./

# Install dependencies and force sqlite3 to build from source
RUN npm install --build-from-source=sqlite3

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Prune dev dependencies to keep the final image small
RUN npm prune --omit=dev

# --- Production Image ---
FROM node:20-slim

WORKDIR /app

# Copy built artifacts and production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY package.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
