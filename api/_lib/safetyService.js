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
// Local/residential-character roads: low traffic by nature of the
// classification itself, even though OSM contributors almost never bother
// tagging sidewalk=yes on a quiet cul-de-sac or a private community road.
// Treating "no sidewalk tag" the same on these as on an arterial road was
// the bug — it painted ordinary quiet streets (private golf-community
// roads included) as "caution" for no reason beyond missing metadata.
const QUIET_HIGHWAYS = new Set(['residential', 'unclassified', 'service'])

/* A rough "is this a pleasant/safe walk" score in 0..1, blending:
   - how much of the route has a sidewalk or is a dedicated pedestrian way
   - how much runs alongside a big road with no sidewalk
   - at night, how much of it is lit */
export function computeSafety({ matchedTags, lighting, date, lat, lng, crime }) {
  const sun = SunCalc.getPosition(date, lat, lng)
  const altitudeDeg = (sun.altitude * 180) / Math.PI
  const isNight = altitudeDeg < -6

  // Per-point classification for the map's route outline — kept aligned
  // with `matchedTags` (which has one entry, possibly null, per input
  // point), unlike the `matched` array below which drops the nulls for the
  // aggregate ratios.
  const pointSafety = matchedTags.map((tags) => classifyPoint(tags, isNight))

  const matched = matchedTags.filter(Boolean)
  if (!matched.length) {
    return {
      score: 0.5,
      note: 'No path data nearby — treating as neutral.',
      crime: crime || null,
      pointSafety,
    }
  }

  let pedestrianFriendly = 0
  let quietRoad = 0
  let exposedBigRoad = 0
  for (const tags of matched) {
    const hw = tags.highway
    const hasSidewalk = ['both', 'left', 'right', 'yes', 'separate'].includes(tags.sidewalk)
    if (PEDESTRIAN_HIGHWAYS.has(hw) || hasSidewalk) pedestrianFriendly++
    else if (QUIET_HIGHWAYS.has(hw)) quietRoad++
    if (BIG_ROADS.has(hw) && !hasSidewalk) exposedBigRoad++
  }
  const pedShare = pedestrianFriendly / matched.length
  const quietShare = quietRoad / matched.length
  const bigRoadShare = exposedBigRoad / matched.length

  let score
  if (isNight) {
    const lit = lighting.litFraction ?? 0.35
    score = 0.2 + 0.5 * lit + 0.3 * pedShare + 0.15 * quietShare - 0.2 * bigRoadShare
  } else {
    score = 0.55 + 0.4 * pedShare + 0.25 * quietShare - 0.35 * bigRoadShare
  }
  score = Math.max(0, Math.min(1, score))

  // A state-wide crime estimate is far coarser than the per-route sidewalk/
  // lighting signal above, so it only nudges the score (±25% at most), not
  // dominate it.
  if (crime?.ratio != null) {
    const crimeFactor = Math.max(0.75, Math.min(1.15, 1.15 - crime.ratio * 0.3))
    score = Math.max(0, Math.min(1, score * crimeFactor))
  }

  const notes = []
  if (pedShare > 0.7) notes.push('mostly sidewalks / paths')
  else if (quietShare > 0.7) notes.push('mostly quiet residential streets')
  else if (bigRoadShare > 0.3) notes.push('runs along busy roads')
  if (isNight) notes.push(lighting.litFraction != null ? 'night — lighting weighted' : 'night')
  if (crime?.label) notes.push(`${crime.state} crime is ${crime.label}`)

  return {
    score: round2(score),
    pedShare: round2(pedShare),
    bigRoadShare: round2(bigRoadShare),
    note: notes.join(' · ') || null,
    crime: crime || null,
    pointSafety,
  }
}

/* One point's classification for the map's route outline — the same
   sidewalk/road-type/lighting signal as the aggregate score above, just
   evaluated locally instead of averaged over the whole route. */
function classifyPoint(tags, isNight) {
  if (!tags) return 'caution' // no matched way nearby — unknown, not "unsafe"
  const hw = tags.highway
  const hasSidewalk = ['both', 'left', 'right', 'yes', 'separate'].includes(tags.sidewalk)
  const pedestrianFriendly = PEDESTRIAN_HIGHWAYS.has(hw) || hasSidewalk
  const exposedBigRoad = BIG_ROADS.has(hw) && !hasSidewalk
  const quiet = QUIET_HIGHWAYS.has(hw)
  const lit = tags.lit === 'yes' || tags.lit === '24/7'
  const unlit = tags.lit === 'no'

  if (exposedBigRoad) return 'risk'
  // Dark + unlit is worth flagging regardless of the neighborhood — this is
  // about visibility, not road classification — so it's untouched by `quiet`.
  if (isNight && unlit && !pedestrianFriendly) return 'risk'
  if (pedestrianFriendly && (!isNight || lit)) return 'safe'
  // A residential/local/service road in daylight doesn't need a sidewalk
  // tag to be an ordinary, safe place to walk — most never get tagged.
  if (quiet && !isNight) return 'safe'
  return 'caution'
}

const round2 = (n) => Math.round(n * 100) / 100
