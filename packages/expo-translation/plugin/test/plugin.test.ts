import assert from 'node:assert/strict'
import {test} from 'node:test'

import {MLKIT_PROPERTY, setPodfileProperties} from '../src/withTranslation'

test('ML Kit stays out of iOS unless asked for', () => {
  assert.deepEqual(setPodfileProperties({}, {}), {[MLKIT_PROPERTY]: 'false'})
  assert.deepEqual(setPodfileProperties({}, {ios: {mlkit: false}}), {[MLKIT_PROPERTY]: 'false'})
})

test('ios.mlkit bundles it', () => {
  assert.deepEqual(setPodfileProperties({}, {ios: {mlkit: true}}), {[MLKIT_PROPERTY]: 'true'})
})

test("the app's other properties are kept", () => {
  assert.deepEqual(setPodfileProperties({'expo.jsEngine': 'hermes'}, {ios: {mlkit: true}}), {
    'expo.jsEngine': 'hermes',
    [MLKIT_PROPERTY]: 'true',
  })
})
