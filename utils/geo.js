import { badRequest } from './ApiError.js';

// GeoJSON Point from {lng, lat}; validates ranges so bad coordinates never reach Mongo.
export const toPoint = (lng, lat) => {
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) {
    throw badRequest('Invalid coordinates');
  }
  return { type: 'Point', coordinates: [x, y] };
};

// Mongo filter: documents within `radiusKm` of a point. Works with a 2dsphere index and
// (unlike $near) can be combined with other filters and custom sorting.
export const withinRadius = (field, lng, lat, radiusKm) => {
  const km = Number(radiusKm) || 15;
  return {
    [field]: {
      $geoWithin: { $centerSphere: [[Number(lng), Number(lat)], km / 6378.1] },
    },
  };
};
