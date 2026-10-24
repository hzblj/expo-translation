import {createRunOncePlugin} from 'expo/config-plugins'

import {withTranslation} from './withTranslation'

export {MLKIT_PROPERTY, setPodfileProperties, type TranslationPluginOptions, withTranslation} from './withTranslation'

const pkg: {name: string; version: string} = require('../../package.json')

export default createRunOncePlugin(withTranslation, pkg.name, pkg.version)
