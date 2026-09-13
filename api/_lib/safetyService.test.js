import { describe, it, expect } from 'vitest'
import { computeSafety } from './safetyService.js'

const DAY = new Date('2026-09-23T17:00:00Z') // daytime, isNight=false
const NIGHT_UNLIT_TAGS = { highway: 'residential' } // no lit tag -> "unlit" only matters at night

describe('computeSafety — per-point classification (pointSafety)', () => {
  it('classifies a footway with a sidewalk as safe', () => {
    const matchedTags = [{ highway: 'footway', sidewalk: 'yes', lit: 'yes' }]
    const lighting = { litFraction: 1 }
    const result = computeSafety({ matchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99 })
    expect(result.pointSafety).toEqual(['safe'])
  })

  it('classifies a busy road with no sidewalk as risk', () => {
    const matchedTags = [{ highway: 'secondary' }]
    const lighting = { litFraction: 0.5 }
    const result = computeSafety({ matchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99 })
    expect(result.pointSafety).toEqual(['risk'])
  })

  it('treats an unlit residential street as risk at night (visibility), but safe in daytime', () => {
    const matchedTags = [{ ...NIGHT_UNLIT_TAGS, lit: 'no' }]
    const lighting = { litFraction: 0 }
    const night = new Date('2026-09-23T04:00:00Z')
    const nightResult = computeSafety({ matchedTags, lighting, date: night, lat: 40.75, lng: -73.99 })
    expect(nightResult.pointSafety).toEqual(['risk'])

    // A quiet residential street with no sidewalk tag (the OSM norm, not the
    // exception) is an ordinary safe place to walk in daylight — treating
    // "no tag" as "caution" here was the bug a real golf-community route
    // exposed: it painted an entirely quiet, gated neighborhood yellow.
    const dayResult = computeSafety({ matchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99 })
    expect(dayResult.pointSafety).toEqual(['safe'])
  })

  it('classifies quiet unclassified/service roads the same as residential in daytime', () => {
    const lighting = { litFraction: 1 }
    for (const highway of ['unclassified', 'service']) {
      const result = computeSafety({ matchedTags: [{ highway }], lighting, date: DAY, lat: 40.75, lng: -73.99 })
      expect(result.pointSafety).toEqual(['safe'])
    }
  })

  it('classifies an unmatched point (no nearby way) as caution, not risk', () => {
    const matchedTags = [null]
    const lighting = { litFraction: null }
    const result = computeSafety({ matchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99 })
    expect(result.pointSafety).toEqual(['caution'])
  })

  it('keeps pointSafety aligned in length with matchedTags even with no matches at all', () => {
    const matchedTags = [null, null, null]
    const lighting = { litFraction: null }
    const result = computeSafety({ matchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99 })
    expect(result.pointSafety).toHaveLength(3)
    expect(result.score).toBe(0.5)
  })
})

describe('computeSafety — aggregate score and crime nudge', () => {
  const matchedTags = [
    { highway: 'footway', sidewalk: 'yes' },
    { highway: 'footway', sidewalk: 'yes' },
  ]
  const lighting = { litFraction: 1 }

  it('scores higher with more sidewalk/pedestrian coverage', () => {
    const good = computeSafety({ matchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99 })
    const bad = computeSafety({
      matchedTags: [{ highway: 'secondary' }, { highway: 'primary' }],
      lighting,
      date: DAY,
      lat: 40.75,
      lng: -73.99,
    })
    expect(good.score).toBeGreaterThan(bad.score)
  })

  it('scores an all-quiet-residential route as clearly safe, not merely neutral', () => {
    const quiet = computeSafety({
      matchedTags: [{ highway: 'residential' }, { highway: 'residential' }],
      lighting,
      date: DAY,
      lat: 40.75,
      lng: -73.99,
    })
    // 0.55 was the old flat "no signal either way" baseline for any road
    // that wasn't explicitly tagged pedestrian-friendly — a real report from
    // a private golf-community route (all quiet residential streets, no
    // sidewalk tags anywhere) scoring only 55% is exactly the bug this
    // guards against.
    expect(quiet.score).toBeGreaterThan(0.7)
  })

  // Mid-range base score (mixed pedestrian/unmatched tags) on purpose, so a
  // crime nudge in either direction has headroom to show without butting up
  // against the 0..1 clamp.
  const midMatchedTags = [{ highway: 'footway', sidewalk: 'yes' }, { highway: 'residential' }]

  it('nudges the score down for a statewide crime rate well above average, up for well below', () => {
    const base = computeSafety({ matchedTags: midMatchedTags, lighting, date: DAY, lat: 40.75, lng: -73.99, crime: null })
    const highCrime = computeSafety({
      matchedTags: midMatchedTags,
      lighting,
      date: DAY,
      lat: 40.75,
      lng: -73.99,
      crime: { state: 'XX', ratio: 1.8, label: 'well above the national average' },
    })
    const lowCrime = computeSafety({
      matchedTags: midMatchedTags,
      lighting,
      date: DAY,
      lat: 40.75,
      lng: -73.99,
      crime: { state: 'YY', ratio: 0.3, label: 'well below the national average' },
    })
    expect(highCrime.score).toBeLessThan(base.score)
    expect(lowCrime.score).toBeGreaterThan(base.score)
    // A state-wide figure is deliberately a nudge, not the dominant factor.
    expect(Math.abs(highCrime.score - base.score)).toBeLessThan(0.3)
  })
})
