import { Extension, Parameter } from 'talkops'

const baseUrl = new Parameter('BASE_URL')
  .setDescription('The base URL of your Domoticz server.')
  .setPossibleValues(['http://domoticz:8080', 'https://domoticz.mydomain.net'])
  .setType('url')

const username = new Parameter('USERNAME')
  .setDescription('The username for authenticating with the Domoticz API.')
  .setDefaultValue('admin')

const password = new Parameter('PASSWORD')
  .setDescription('The password related to username.')
  .setDefaultValue('domoticz')
  .setType('password')

const extension = new Extension()
  .setName('Domoticz')
  .setWebsite('https://www.domoticz.com/')
  .setCategory('home_automation')
  .setIcon(
    'https://play-lh.googleusercontent.com/R9wJDHfZh-29Mlgiqn6MIlc21gUMI0gQXWfTlzru8lLpls0xUa3vSEGCeMjNE3MH6l8',
  )
  .setFeatures([
    'Lights: Check status, turn on/off',
    'Shutters: Check status, open, close and stop',
    'Scene: Check status, enable, disable and toggle',
    'Sensors: Check status',
  ])
  .setinstallationSteps([
    'Make sure your Domoticz version is newer than `2023.2`',
    'Open Domoticz from a web browser with admin permissions.',
    'Enable the API: `Setup → Settings → Security`',
    'Create a new user specifically for the TalkOps integration: `Setup → Users`',
    'Grant this user access to the devices you want to control by voice: `Set Devices`',
    'Set the environment variables using the credentials of the newly created user.',
  ])
  .setParameters([baseUrl, username, password])

import axios from 'axios'
import yaml from 'js-yaml'

import floorsModel from './src/models/floors.json' with { type: 'json' }
import roomsModel from './src/models/rooms.json' with { type: 'json' }
import lightsModel from './src/models/lights.json' with { type: 'json' }
import shuttersModel from './src/models/shutters.json' with { type: 'json' }
import sensorsModel from './src/models/sensors.json' with { type: 'json' }
import scenesModel from './src/models/scenes.json' with { type: 'json' }

import updateLightsFunction from './src/functions/update_lights.json' with { type: 'json' }
import updateScenesFunction from './src/functions/update_scenes.json' with { type: 'json' }
import updateShuttersFunction from './src/functions/update_shutters.json' with { type: 'json' }

const baseInstructions = `
You are a home automation assistant, focused solely on managing connected devices in the home.
When asked to calculate an average, **round to the nearest whole number** without explaining the calculation.
`

const defaultInstructions = `
Currently, no connected devices have been assigned to you.
Your sole task is to ask the user to install one or more connected devices in the home before proceeding.
`

async function request(param) {
  const response = await axios.get(`${baseUrl.getValue()}/json.htm?type=command&param=${param}`, {
    auth: {
      username: username.getValue(),
      password: password.getValue(),
    },
  })
  return response.data
}

let timeout = null
async function refresh() {
  timeout && clearTimeout(timeout)
  let floors = []
  let rooms = []
  let lights = []
  let shutters = []
  let sensors = []
  let scenes = []

  try {
    const v = await request('getversion')
    extension.setSoftwareVersion(v.version)

    const p = await request('getsettings')

    const fps = await request('getfloorplans')
    if (fps.result) {
      for (const fp of fps.result) {
        floors.push({
          id: parseInt(fp.idx),
          name: fp.Name,
        })
        const fpps = await request(`getfloorplanplans&idx=${fp.idx}`)
        if (fpps.result) {
          for (const fpp of fpps.result) {
            fpp.floor = fp.idx
            rooms.push({
              id: parseInt(fpp.idx),
              name: fpp.Name,
              floor_id: parseInt(fp.idx),
            })
          }
        }
      }
    }
    const ds = await request('getdevices')
    if (ds.result) {
      for (const d of ds.result) {
        let room_id = null
        let pid = d.PlanIDs.filter((value) => value !== 0)[0]
        if (pid) {
          room_id = pid
        }
        if (d.SwitchType === 'On/Off') {
          lights.push({
            id: parseInt(d.idx),
            name: d.Name,
            description: d.Description || null,
            state: d.Status === 'On' ? 'on' : 'off',
            room_id,
          })
        } else if (d.SwitchType === 'Blinds' || d.SwitchType === 'Blinds + Stop') {
          let state = 'opened'
          if (d.Status === 'Closed') state = 'closed'
          if (d.Status === 'Stopped') state = 'unknown'
          shutters.push({
            id: parseInt(d.idx),
            name: d.Name,
            description: d.Description || null,
            state,
            room_id,
          })
        } else if (d.Type.startsWith('Temp')) {
          if (d.Temp !== undefined) {
            sensors.push({
              name: d.Name,
              description: d.Description || null,
              type: 'temperature',
              value: `${d.Temp}`,
              unit: p.TempUnit === 1 ? '°F' : '°C',
              room_id,
            })
          }
          if (d.Humidity !== undefined) {
            sensors.push({
              name: d.Name,
              description: d.Description || null,
              type: 'humidity',
              value: `${d.Humidity}`,
              unit: '%',
              room_id,
            })
          }
          if (d.Barometer !== undefined) {
            sensors.push({
              name: d.Name,
              description: d.Description || null,
              type: 'pressure',
              value: `${d.Barometer}`,
              unit: 'hPa',
              room_id,
            })
          }
        } else if (d.Type.startsWith('Air Quality')) {
          sensors.push({
            name: d.Name,
            description: d.Description || null,
            type: 'air_quality',
            value: d.Data.replace(/ ppm$/, ''),
            unit: 'ppm',
            room_id,
          })
        }
      }
    }
    const ss = await request('getscenes')
    if (ss.result) {
      for (const s of ss.result) {
        let state = null
        if (s.Type === 'Group') {
          state = s.Status === 'On' ? 'enabled' : 'disabled'
        }
        scenes.push({
          id: parseInt(s.idx),
          name: s.Name,
          state,
        })
      }
    }

    const instructions = [baseInstructions]

    if (!lights.length && !shutters.length && !sensors.length && !scenes.length) {
      instructions.push(defaultInstructions)
    } else {
      instructions.push('``` yaml')
      instructions.push(
        yaml.dump({
          floorsModel,
          roomsModel,
          lightsModel,
          shuttersModel,
          sensorsModel,
          scenesModel,
          floors,
          rooms,
          lights,
          shutters,
          sensors,
          scenes,
        }),
      )
      instructions.push('```')
    }
    extension.setInstructions(instructions.join('\n'))

    const functionSchemas = []
    if (lights) {
      functionSchemas.push(updateLightsFunction)
    }
    if (scenes) {
      functionSchemas.push(updateScenesFunction)
    }
    if (shutters) {
      functionSchemas.push(updateShuttersFunction)
    }
    extension.setFunctionSchemas(functionSchemas)
  } catch (err) {
    console.error(err.message)
  }

  timeout = setTimeout(refresh, 5000)
}

extension.setFunctions([
  async function update_lights(action, ids) {
    try {
      for (const id of ids) {
        const response = await request(`switchlight&idx=${id}&switchcmd=${action}`)
        if (response.status === 'ERR') {
          throw { message: 'bad_request' }
        }
      }
      return 'Done.'
    } catch (e) {
      return `Error: ${e.message}`
    }
  },
  async function update_shutters(action, ids) {
    try {
      for (const id of ids) {
        const response = await request(`switchlight&idx=${id}&switchcmd=${action}`)
        if (response.status === 'ERR') {
          throw { message: 'bad_request' }
        }
      }
      return `${action}ing.`
    } catch (e) {
      return `Error: ${e.message}`
    }
  },
  async function update_scenes(action, ids) {
    try {
      for (const id of ids) {
        const response = await request(`switchscene&idx=${id}&switchcmd=${action}`)
        if (response.status === 'ERR') {
          throw { message: 'bad_request' }
        }
      }
      return 'Done.'
    } catch (e) {
      return `Error: ${e.message}`
    }
  },
])

extension.setBootstrap(refresh)
