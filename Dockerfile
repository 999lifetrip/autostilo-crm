FROM node:20-alpine

WORKDIR /app

# Copia o backend
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copia tudo
COPY . .

WORKDIR /app/backend

EXPOSE 3100

CMD ["node", "server.js"]
