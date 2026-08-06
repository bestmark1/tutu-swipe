export interface RandomState {
  state: number;
}

export function createRandomState(seed: number): RandomState {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError("Ranking seed must be a safe integer");
  }
  return { state: seed >>> 0 };
}

export function sampleStandardNormal(random: RandomState): number {
  const first = Math.max(nextUniform(random), Number.EPSILON);
  const second = nextUniform(random);
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function nextUniform(random: RandomState): number {
  random.state = (random.state + 0x6d2b79f5) >>> 0;
  let value = random.state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}
