FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
# Include devDependencies: the app runs via `tsx` (a devDependency) at runtime.
COPY package.json package-lock.json* ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY data ./data

ENV NODE_ENV=production

# Default command runs the API; compose overrides it for worker/scheduler.
CMD ["npm", "run", "api"]
