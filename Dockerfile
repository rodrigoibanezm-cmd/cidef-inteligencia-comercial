FROM node:22-alpine AS dependencies
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm install --no-audit --no-fund
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npm", "start"]

FROM dependencies AS source
COPY . .

FROM source AS projections-source
RUN node scripts/prepare-projections-build.js /projections

FROM dependencies AS projections-build
COPY --from=projections-source /projections/ ./
RUN npm run build

# Proyecciones: docker build --target projections -t cidef-proyecciones .
FROM projections-build AS projections

# Keep the complete build as the default target.
FROM source AS full
RUN npm run build

