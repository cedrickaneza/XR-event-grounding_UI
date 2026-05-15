// AUTO-GENERATED from IndustReal_Pipeline/results/*.
// Real data, parsed at build time from the IndustReal pipeline outputs.
// Schema mirrors the Neo4j graph (Goal -> Phase -> Event -> Component).

window.INDUSTREAL_DATA = {
  "clips": {
    "03_assy_0_1": {
      "id": "03_assy_0_1",
      "duration_s": 275.4,
      "n_frames": 2754,
      "metrics": {
        "pos": 1,
        "f1": 1,
        "avg_delay_s": 2.97,
        "system_TPs": 9,
        "system_FPs": 0,
        "system_FNs": 0
      },
      "goal": {
        "id": "goal::03_assy_0_1",
        "name": "Reach final CAD assembly state",
        "target_state_index": 22,
        "target_state_name": "11101111111",
        "target_state_asset": "part_geometries/state22.fbx",
        "target_components": [
          "base",
          "front chassis",
          "front chassis pin",
          "short rear chassis",
          "front rear chassis pin",
          "rear rear chassis pin",
          "front bracket",
          "front bracket screw",
          "front wheel assy",
          "rear wheel assy"
        ]
      },
      "phases": [
        {
          "id": "initial_setup",
          "name": "Initial setup",
          "order": 1,
          "first_frame": 709,
          "last_frame": 709,
          "step_count": 1,
          "status": "observed"
        },
        {
          "id": "chassis_assembly",
          "name": "Chassis assembly",
          "order": 2,
          "first_frame": 709,
          "last_frame": 1187,
          "step_count": 2,
          "status": "observed"
        },
        {
          "id": "connector_installation",
          "name": "Connector installation",
          "order": 3,
          "first_frame": 709,
          "last_frame": 1788,
          "step_count": 4,
          "status": "observed"
        },
        {
          "id": "bracket_assembly",
          "name": "Bracket assembly",
          "order": 4,
          "first_frame": 1788,
          "last_frame": 1788,
          "step_count": 1,
          "status": "observed"
        },
        {
          "id": "wheel_assembly",
          "name": "Wheel assembly",
          "order": 5,
          "first_frame": 1788,
          "last_frame": 2735,
          "step_count": 2,
          "status": "observed"
        },
        {
          "id": "correction_handling",
          "name": "Correction handling",
          "order": 6,
          "first_frame": 2735,
          "last_frame": 2735,
          "step_count": 1,
          "status": "observed"
        }
      ],
      "events": [
        {
          "id": "event::03_assy_0_1::0",
          "local_id": 0,
          "step_id": 9,
          "frame": 709,
          "time_s": 70.9,
          "event_type": "INSTALL",
          "component": "rear chassis",
          "component_id": "industreal_component::rear_chassis",
          "action_desc": "Install rear chassis",
          "conf": 1,
          "phase_key": "chassis_assembly"
        },
        {
          "id": "event::03_assy_0_1::1",
          "local_id": 1,
          "step_id": 15,
          "frame": 709,
          "time_s": 70.9,
          "event_type": "INSTALL",
          "component": "front rear chassis pin",
          "component_id": "industreal_component::front_rear_chassis_pin",
          "action_desc": "Install front rear chassis pin",
          "conf": 1,
          "phase_key": "connector_installation"
        },
        {
          "id": "event::03_assy_0_1::2",
          "local_id": 2,
          "step_id": 18,
          "frame": 709,
          "time_s": 70.9,
          "event_type": "INSTALL",
          "component": "rear rear chassis pin",
          "component_id": "industreal_component::rear_rear_chassis_pin",
          "action_desc": "Install rear rear chassis pin",
          "conf": 1,
          "phase_key": "connector_installation"
        },
        {
          "id": "event::03_assy_0_1::3",
          "local_id": 3,
          "step_id": 3,
          "frame": 1187,
          "time_s": 118.7,
          "event_type": "INSTALL",
          "component": "front chassis",
          "component_id": "industreal_component::front_chassis",
          "action_desc": "Install front chassis",
          "conf": 1,
          "phase_key": "chassis_assembly"
        },
        {
          "id": "event::03_assy_0_1::4",
          "local_id": 4,
          "step_id": 6,
          "frame": 1187,
          "time_s": 118.7,
          "event_type": "INSTALL",
          "component": "front chassis pin",
          "component_id": "industreal_component::front_chassis_pin",
          "action_desc": "Install front chassis pin",
          "conf": 1,
          "phase_key": "connector_installation"
        },
        {
          "id": "event::03_assy_0_1::5",
          "local_id": 5,
          "step_id": 30,
          "frame": 1788,
          "time_s": 178.8,
          "event_type": "INSTALL",
          "component": "rear wheel assy",
          "component_id": "industreal_component::rear_wheel_assy",
          "action_desc": "Install rear wheel assy",
          "conf": 1,
          "phase_key": "wheel_assembly"
        },
        {
          "id": "event::03_assy_0_1::6",
          "local_id": 6,
          "step_id": 21,
          "frame": 2735,
          "time_s": 273.5,
          "event_type": "INSTALL",
          "component": "front bracket",
          "component_id": "industreal_component::front_bracket",
          "action_desc": "Install front bracket",
          "conf": 1,
          "phase_key": "bracket_assembly"
        },
        {
          "id": "event::03_assy_0_1::7",
          "local_id": 7,
          "step_id": 24,
          "frame": 2735,
          "time_s": 273.5,
          "event_type": "INSTALL",
          "component": "front bracket screw",
          "component_id": "industreal_component::front_bracket_screw",
          "action_desc": "Install front bracket screw",
          "conf": 1,
          "phase_key": "bracket_assembly"
        },
        {
          "id": "event::03_assy_0_1::8",
          "local_id": 8,
          "step_id": 27,
          "frame": 2735,
          "time_s": 273.5,
          "event_type": "INSTALL",
          "component": "front wheel assy",
          "component_id": "industreal_component::front_wheel_assy",
          "action_desc": "Install front wheel assy",
          "conf": 1,
          "phase_key": "wheel_assembly"
        }
      ],
      "components_in_clip": [
        "front chassis",
        "front chassis pin",
        "rear chassis",
        "front rear chassis pin",
        "rear rear chassis pin",
        "front bracket",
        "front bracket screw",
        "front wheel assy",
        "rear wheel assy"
      ]
    },
    "03_assy_1_3": {
      "id": "03_assy_1_3",
      "duration_s": 263,
      "n_frames": 2630,
      "metrics": {
        "pos": 0,
        "f1": 0,
        "avg_delay_s": null,
        "system_TPs": 0,
        "system_FPs": 0,
        "system_FNs": 3
      },
      "goal": {
        "id": "goal::03_assy_1_3",
        "name": "Reach final CAD assembly state",
        "target_state_index": 22,
        "target_state_name": "11101111111",
        "target_state_asset": "part_geometries/state22.fbx",
        "target_components": [
          "base",
          "front chassis",
          "front chassis pin",
          "short rear chassis",
          "front rear chassis pin",
          "rear rear chassis pin",
          "front bracket",
          "front bracket screw",
          "front wheel assy",
          "rear wheel assy"
        ]
      },
      "phases": [
        {
          "id": "initial_setup",
          "name": "Initial setup",
          "order": 1,
          "first_frame": 519,
          "last_frame": 519,
          "step_count": 1,
          "status": "observed"
        },
        {
          "id": "chassis_assembly",
          "name": "Chassis assembly",
          "order": 2,
          "first_frame": 519,
          "last_frame": 902,
          "step_count": 3,
          "status": "observed"
        },
        {
          "id": "connector_installation",
          "name": "Connector installation",
          "order": 3,
          "first_frame": 519,
          "last_frame": 902,
          "step_count": 4,
          "status": "observed"
        },
        {
          "id": "bracket_assembly",
          "name": "Bracket assembly",
          "order": 4,
          "first_frame": 902,
          "last_frame": 902,
          "step_count": 1,
          "status": "observed"
        },
        {
          "id": "wheel_assembly",
          "name": "Wheel assembly",
          "order": 5,
          "first_frame": 902,
          "last_frame": 902,
          "step_count": 2,
          "status": "observed"
        },
        {
          "id": "correction_handling",
          "name": "Correction handling",
          "order": 6,
          "first_frame": 902,
          "last_frame": 902,
          "step_count": 1,
          "status": "observed"
        }
      ],
      "events": [
        {
          "id": "event::03_assy_1_3::0",
          "local_id": 0,
          "step_id": 9,
          "frame": 519,
          "time_s": 51.9,
          "event_type": "INSTALL",
          "component": "rear chassis",
          "component_id": "industreal_component::rear_chassis",
          "action_desc": "Install rear chassis",
          "conf": 1,
          "phase_key": "chassis_assembly"
        },
        {
          "id": "event::03_assy_1_3::1",
          "local_id": 1,
          "step_id": 15,
          "frame": 519,
          "time_s": 51.9,
          "event_type": "INSTALL",
          "component": "front rear chassis pin",
          "component_id": "industreal_component::front_rear_chassis_pin",
          "action_desc": "Install front rear chassis pin",
          "conf": 1,
          "phase_key": "connector_installation"
        },
        {
          "id": "event::03_assy_1_3::2",
          "local_id": 2,
          "step_id": 18,
          "frame": 519,
          "time_s": 51.9,
          "event_type": "INSTALL",
          "component": "rear rear chassis pin",
          "component_id": "industreal_component::rear_rear_chassis_pin",
          "action_desc": "Install rear rear chassis pin",
          "conf": 1,
          "phase_key": "connector_installation"
        }
      ],
      "components_in_clip": [
        "rear chassis",
        "front rear chassis pin",
        "rear rear chassis pin"
      ]
    }
  },
  "components": [
    {
      "id": "industreal_component::base",
      "name": "base",
      "normalized": "base"
    },
    {
      "id": "industreal_component::front_bracket",
      "name": "front bracket",
      "normalized": "front_bracket"
    },
    {
      "id": "industreal_component::front_bracket_screw",
      "name": "front bracket screw",
      "normalized": "front_bracket_screw"
    },
    {
      "id": "industreal_component::front_chassis",
      "name": "front chassis",
      "normalized": "front_chassis"
    },
    {
      "id": "industreal_component::front_chassis_pin",
      "name": "front chassis pin",
      "normalized": "front_chassis_pin"
    },
    {
      "id": "industreal_component::front_rear_chassis_pin",
      "name": "front rear chassis pin",
      "normalized": "front_rear_chassis_pin"
    },
    {
      "id": "industreal_component::front_wheel_assy",
      "name": "front wheel assy",
      "normalized": "front_wheel_assy"
    },
    {
      "id": "industreal_component::rear_chassis",
      "name": "rear chassis",
      "normalized": "rear_chassis"
    },
    {
      "id": "industreal_component::rear_rear_chassis_pin",
      "name": "rear rear chassis pin",
      "normalized": "rear_rear_chassis_pin"
    },
    {
      "id": "industreal_component::rear_wheel_assy",
      "name": "rear wheel assy",
      "normalized": "rear_wheel_assy"
    },
    {
      "id": "industreal_component::short_rear_chassis",
      "name": "short rear chassis",
      "normalized": "short_rear_chassis"
    }
  ],
  "default_clip": "03_assy_0_1"
};
