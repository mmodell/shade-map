import SunCalc from 'suncalc'

const PEDESTRIAN_HIGHWAYS = new Set([
  'footway',
  'path',
  'pedestrian',
  'living_street',
  'steps',
  'track',
])
const BIG_ROADS = new Set(['secondary', 'primary', 'trunk'])

/* A rough "is this a pleasant/safe walk" score in 0..1, blending:
   - how much of the route has a sidewalk or is a dedicated pedestrian way
   - how much runs alongside a big road with no sidewalk
   - at night, how much of it is lit */
export function computeSafety({ matchedTags, lighting, date, lat, lng }) {
  const matched = matchedTags.filter(Boolean)
  if (!matched.length) {
    return { score: 0.5, note: 'No path data nearby — treating as neutral.' }
  }

  let pedestrianFriendly = 0
  let exposedBigRoad = 0
  for (const tags of matched) {
    const hw = tags.highway
    const hasSidewalk = ['both', 'left', 'right', 'yes', 'separate'].includes(tags.sidewalk)
    if (PEDESTRIAN_HIGHWAYS.has(hw) || hasSidewalk) pedestrianFriendly++
    if (BIG_ROADS.has(hw) && !hasSidewalk) exposedBigRoad++
  }
  const pedShare = pedestrianFriendly / matched.length
  const bigRoadShare = exposedBigRoad / matched.length

  const sun = SunCalc.getPosition(date, lat, lng)
  const altitudeDeg = (sun.altitude * 180) / Math.PI
  const isNight = altitudeDeg < -6

  let score
  if (isNight) {
    const lit = lighting.litFraction ?? 0.35
    score = 0.2 + 0.5 * lit + 0.3 * pedShare - 0.2 * bigRoadShare
  } else {
    score = 0.55 + 0.4 * pedShare - 0.35 * bigRoadShare
  }
  score = Math.max(0, Math.min(1, score))

  const notes = []
  if (pedShare > 0.7) notes.push('mostly sidewalks / paths')
  else if (bigRoadShare > 0.3) notes.push('runs along busy roads')
  if (isNight) notes.push(lighting.litFraction != null ? 'night — lighting weighted' : 'night')

  return { score: round2(score), pedShare: round2(pedShare), bigRoadShare: round2(bigRoadShare), note: notes.join(' · ') || null }
}

const round2 = (n) => Math.round(n * 100) / 100
