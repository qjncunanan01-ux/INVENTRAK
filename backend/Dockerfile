FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4001

# Run the unified npm-free server (identical API surface, zero native deps):
# it serves the JSON files by default and auto-selects Firebase Firestore when
# the FIREBASE_* env vars are present — "Firebase as the database of it all".
CMD ["node", "src/server_npmfree.js"]
