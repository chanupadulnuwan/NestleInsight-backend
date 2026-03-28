export type LocationPoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

const earthRadiusKm = 6371;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function calculateDistanceKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) {
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

export function findNearestLocation<T extends LocationPoint>(
  latitude: number,
  longitude: number,
  locations: T[],
) {
  if (locations.length === 0) {
    return null;
  }

  return locations.reduce((closest, candidate) => {
    const candidateDistanceKm = calculateDistanceKm(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude,
    );

    if (!closest) {
      return {
        item: candidate,
        distanceKm: candidateDistanceKm,
      };
    }

    return candidateDistanceKm < closest.distanceKm
      ? {
          item: candidate,
          distanceKm: candidateDistanceKm,
        }
      : closest;
  }, null as { item: T; distanceKm: number } | null);
}

export function buildDefaultInventoryCapacity(productsPerCase: number) {
  return Math.max(24, Math.min(240, productsPerCase * 4));
}

export function buildDefaultReorderLevel(maxCapacityCases: number) {
  return Math.max(6, Math.ceil(maxCapacityCases * 0.2));
}
