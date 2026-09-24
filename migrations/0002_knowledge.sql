create table if not exists articles (
  id text primary key,
  title text not null,
  category text not null,
  tags text not null default '',
  body text not null,
  published boolean not null default true,
  source_note text not null default '',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Starter notes from public PSI pages. ON CONFLICT DO NOTHING so later edits stick.
insert into articles (id, title, category, tags, body, published, source_note, sort_order) values
(
  'plate',
  'Engine plate — PSI 88L diesel',
  'Identity',
  '88l, 88l-d, displacement, bore, stroke, ratings, weight, dimensions, rotation, v-16, model',
  $plate$
This desk supports one engine: the Power Solutions International 88-liter diesel, published as model 88L-D and as "88 Liter Diesel". It is not the PSI 8.8-liter industrial gas engine.

Published identity. Figures are subject to change and to site conditions.

- Configuration: V-16
- Displacement: 87.5 liters
- Compression ratio: 16.5:1
- Bore x stroke: 7.09 in x 8.46 in (180 mm x 215 mm)
- Fuel: diesel
- Rotation: counter-clockwise viewed on the flywheel
- Induction: turbocharged, water-air intercooler. Two compressors feed a single intercooler mounted over the flywheel housing, vertical flow.
- Dry weight on the PSI Energy datasheet: 25,353 lb (11,500 kg)
- Outline: length 163.8 in (4,161 mm), width 76.9 in (1,952 mm), height 97.2 in (2,468 mm)

Standby power rows published for this family (SAE J1995, following PSI specification, tolerance plus or minus 5 percent). kWe assumes standard mechanical and electrical losses. These are not a site rating.

- 2,800 kWe / 3,150 kWm
- 3,000 kWe / 3,350 kWm
- 3,300 kWe / 3,600 kWm

The public product page lists those three standby rows under 60 Hz (1,800 rpm). The downloadable datasheet layout may assign the 2,800 kWe row to 50 Hz (1,500 rpm) and the higher rows to 60 Hz. Do not pick one assignment if the installed nameplate or the current datasheet disagrees. Ask for the nameplate kWe and rated rpm.

Flywheel: the product page lists an SAE 0 housing and an 18 in flywheel. The datasheet has been read as an SAE 00 housing and a 21 in flywheel. Confirm on the unit before ordering a coupling.

Application is prime or standby power generation. Ratings are reference only.
$plate$,
  true,
  'PSI product page (88 Liter Diesel) and PSI Energy 88L diesel datasheet. Subject to change.',
  10
),
(
  'block',
  'Block, liners, heads, and crank',
  'Mechanical',
  'block, liner, head, crank, valves, piston, knock, inspection door',
  $block$
Published construction of the 88L-D:

- Cast-iron cylinder block with an inspection door per cylinder.
- Wet cast-iron liners, replaceable.
- Replaceable valve guides and seats.
- Separate cast-iron cylinder heads, four valves per cylinder.
- Forged steel crankshaft with induction-hardened journals, crankpins, and fillets.
- Light-alloy pistons, lube-oil cooled, with high-performance rings.

A knock that follows one cylinder, plus coolant loss, is a reason to stop and inspect that liner and head. The inspection doors exist so a cylinder can be looked at without splitting the engine. This desk cannot localize a knock from a chat description to a cylinder number.

No bearing clearances, end-play, or torque values are published in this library. Do not invent them.
$block$,
  true,
  'Feature list on the PSI 88 Liter Diesel product page and datasheet.',
  20
),
(
  'fuel',
  'Common-rail fuel system',
  'Fuel',
  'fuel, common rail, high pressure, water separator, filter, lift pump, hard start, no start, air in fuel',
  $fuel$
Published fuel hardware:

- High-pressure common rail.
- One high-pressure pump, gear-driven, in the V angle of the cylinder block.
- Three-level filter that integrates water separation, with an electric fuel pump.

Field checks, in order, for a hard start, a no-start after cranking, low power, or unstable rpm. These are general common-rail checks. This library does not contain PSI rail-pressure setpoints, injector codes, or filter part numbers.

1. Confirm the fuel, and that the tank supply and return are open. Water or debris is the first suspect on a three-stage separator.
2. Drain the water separator. Look for water, algae, or wax. Replace the cartridge if the restriction indicator is tripped or the element is overdue.
3. Listen for the electric fuel pump during pre-start. No sound, or a blown fuse, means the rail will not fill.
4. Check the suction side for air: loose filter-head fittings, a cracked pickup, an empty day tank. An engine that cranks and stalls, or never fires, often has air rather than a dead high-pressure pump.
5. After filter service, prime before a long crank. Extended cranking with a dry rail overheats the starters.
6. High-pressure pump and injector diagnosis needs the current PSI procedure and the correct tools. Stop when the next step needs a rail-pressure limit. It is not in this library.

Do not crack a high-pressure line to see if fuel comes out. Common-rail pressure can cause injection injury.
$fuel$,
  true,
  'Fuel hardware from the public datasheet. Checks are field practice, not a PSI procedure.',
  30
),
(
  'lube',
  'Pre-lube, oil cooler, and low pressure',
  'Lubrication',
  'oil, oil pressure, pre-lube, prelube, purifier, cooler, level, bearing',
  $lube$
Published lubrication hardware:

- Electric pre-lube oil pump, so the engine is lubricated before cranking.
- Lube-oil purifier with a replaceable cartridge.
- High-temperature-circuit, water-cooled lube-oil cooler.
- Light-alloy pistons cooled by lube oil.

Field notes:

- Do not crank until pre-lube has run and oil pressure is indicated, if the controller provides that interlock. Bypassing pre-lube on an 11,500 kg V-16 is how bearings get wiped.
- Low oil pressure at idle after a hot soak: check the shutdown level first, then the purifier cartridge for collapse or an unseated bypass, then cooler restriction, then the electric pre-lube circuit. A mechanical pump fault is possible and is not the first check.
- Oil in the coolant, or coolant in the oil, points at the oil cooler or a liner or head seal. Wet liners are replaceable. Do not keep running to see if it clears.
- This library has no PSI oil-pressure setpoints, viscosity grade, or sump capacity. Ask for the gauge reading, oil temperature, and rpm. The setpoint has to come from the current manual.

A low-oil-pressure alarm or a red stop is a shutdown, not a reset-and-reload.
$lube$,
  true,
  'Hardware from the public datasheet. Setpoints are not published here.',
  40
),
(
  'cooling',
  'High-temperature and low-temperature circuits',
  'Cooling',
  'coolant, overheat, temperature, ht, lt, intercooler, water pump, belt, radiator',
  $cooling$
Two coolant circuits are published:

- High-temperature circuit with two gear-driven coolant pumps.
- Low-temperature circuit with one belt-driven coolant pump.
- Charge air is cooled in one water-air intercooler (two compressors, vertical flow, over the flywheel housing).
- The lube-oil cooler is on the high-temperature water circuit.

High coolant temperature, in order:

1. Confirm which gauge. Jacket (HT) and aftercooler (LT) are not the same loop. A slipping LT belt can overheat charge air and pull power down while the jacket gauge still looks acceptable. The reverse is also true.
2. Check radiator or heat-exchanger airflow, raw-water flow, debris, and closed louvers. Skid fans and raw-water pumps are not the engine.
3. Check coolant level and contamination (oil or combustion gas). Combustion gas in the HT bottle often means a head, a gasket, or a liner seal. Heads are separate. Liners are wet and replaceable.
4. A circuit that never comes off bypass will overheat under load. Do not quote a thermostat opening temperature. It is not in this library.
5. The HT pumps are gear-driven. They do not use a belt. A howl or a sudden loss of jacket flow is a pump, a drive, or aeration. The LT pump is belt-driven. Inspect that belt on its own.
6. A high-temperature shutdown: do not restart until the cause is known and the engine has cooled. A restart to see if it holds can crack a head.
$cooling$,
  true,
  'Circuit layout from the public datasheet. Checks are field practice.',
  50
),
(
  'air',
  'Air filters, turbos, and black smoke',
  'Air',
  'air filter, turbo, boost, intercooler, black smoke, low power, exhaust, restriction',
  $air$
Published induction hardware:

- Air filters with cast-iron housings, installed on the cylinder heads.
- Two turbo compressors into one water-air intercooler.
- Heat shields on the exhaust manifold and the turbocharger.

Low power, black smoke, or a high exhaust temperature the technician reports:

1. Read restriction on both filter housings. A V engine can plug one bank and still run.
2. Check intercooler contamination and LT-circuit flow. Hot intake air cuts density.
3. Look for boost leaks between the compressor discharge and the intake, especially after cooler work. Soapy water at a fast idle first, not at rated load.
4. Check turbo shaft play and compressor-wheel damage. The public datasheet does not say whether boost is wastegated. Do not assume a wastegate.
5. Check exhaust restriction: silencer, a collapsed heat shield, a closed rain cap.

White smoke when the engine is hot is unburned fuel or coolant, not a dirty air filter.
$air$,
  true,
  'Induction hardware from the public datasheet. Checks are field practice.',
  60
),
(
  'electrical',
  '24 V starters, charging, and no-crank',
  'Electrical',
  'starter, no crank, 24v, battery, alternator, solenoid, pre-lube interlock, voltage',
  $electrical$
Published electrical hardware:

- 24 V electric starter motors in parallel.
- A battery-charging alternator.
- The electric pre-lube pump should finish before crank, when the controller enforces that.

No-crank:

1. Treat it as 24 V, not 12 V. Parallel starters pull a very high current. Voltage at the starter studs during a crank attempt matters more than open-circuit battery voltage.
2. Check battery interconnects, the ground to the block, and starter-solenoid control. One weak battery in a parallel bank drags both starters.
3. On a genset controller, a latched shutdown, an emergency stop, or a pre-lube interlock will inhibit crank. Read the active alarm before bridging anything.
4. One starter that clicks while the other spins, or neither moving, can be an open cable or a bad solenoid on one motor. Do not hold the start command.

Slow crank and no fire: confirm cranking speed is actually normal, then use the fuel note. Do not quote a minimum cranking rpm. It is not in this library.

The datasheet does not say whether the charging alternator is belt-driven or gear-driven. If the technician reports a belt, treat that as an observation.
$electrical$,
  true,
  'Starting hardware from the public datasheet. Checks are field practice.',
  70
),
(
  'smoke',
  'Reading exhaust smoke',
  'Symptoms',
  'smoke, white smoke, blue smoke, black smoke, coolant loss, oil consumption',
  $smoke$
Ask which color, whether it is only on start, and whether the coolant level is dropping.

- Cold white smoke that clears can be unburned fuel on a cold start. If it does not clear, suspect air in the fuel, a leaking injector, low compression on a bank, or coolant.
- White smoke with a sweet smell, dropping coolant, and no rise in oil level: coolant in a cylinder (liner, head, or gasket). Shut down.
- Blue smoke is oil. Published oil-control hardware is the oil-cooled pistons and the purifier cartridge. Check overfill first, then turbo shaft seals (oil at the compressor inlet or the turbine), then rings and liners. Do not assume rings without a test the manual allows.
- Black smoke at load: air (filters, boost leak, LT cooler) or over-fueling. At no-load, a small puff is not a diagnosis.
- A gray or blue haze right after intercooler or turbo work can be oil spilled into the intake. A haze that persists is not leftover spill.

Do not invent an opacity limit or an emissions-test number. None is in this library.
$smoke$,
  true,
  'Field practice tied to the published oil-cooled pistons, turbos, and wet liners.',
  80
),
(
  'trips',
  'Protection trips and red-stop alarms',
  'Symptoms',
  'shutdown, trip, overspeed, red stop, alarm, low oil pressure, high temp, reset',
  $trips$
The public datasheet does not list shutdown setpoints. Genset controllers add their own.

- Low oil pressure, high coolant temperature, overspeed, or a red stop: shut down if the engine has not already tripped. Do not reset and reload the set to see if it stays up until the trip is understood.
- Record the alarm text, rpm, oil pressure, oil temperature, both coolant temperatures if they are shown, and hours before the fault is cleared.
- Overspeed on a generator is as often a governor, an actuator, a coupling, or a speed-signal fault as it is an engine fuel fault. A stuck mechanical rack is less likely on a common-rail engine than a controller or speed-signal problem. A failed injector or a blocked return can still over-fuel. Do not name a root cause without the alarm log.
- Never suggest defeating a protection input to "get the set online."
$trips$,
  true,
  'Safety practice. Setpoints are not in the public datasheet.',
  90
),
(
  'speed',
  'Unstable rpm and load acceptance',
  'Symptoms',
  'rpm, hunt, hunting, governor, frequency, 1800, 1500, load acceptance',
  $speed$
Ratings are discussed at 1,500 rpm and 1,800 rpm class speeds. The governor lives in the genset controller or ECU and is not specified on the public datasheet.

Unstable rpm:

1. Confirm the complaint is engine speed and not bus frequency from a loose coupling or a bad speed signal. Do not invent the sensor type.
2. Air in the fuel is the most common mechanical cause of a hunt on a common-rail diesel after a filter change. Use the fuel note.
3. A partly plugged water separator makes load acceptance look like a governor problem. It is not one.
4. Do not adjust governor gains from this chat. No gain values are published here. Record whether it hunts at no-load or only on load, the rated rpm, and the droop the controller is set to.

A slow return to speed after a large load step, with normal smoke and normal temperatures, is a controller question. Black smoke during the same step is an air or fuel question.
$speed$,
  true,
  'Field practice. No governor calibration is published for the 88L-D here.',
  100
),
(
  'scope',
  'What this library does not contain',
  'Limits',
  'manual, dtc, torque, parts, capacity, dealer, support, limits',
  $scope$
88L Desk may only cite notes an admin has published, plus cautious field practice that does not add numbers.

Not in the public starter library, and not to be invented:

- Diagnostic trouble codes and wiring pinouts
- Torque tables, valve lash, injector trim codes, rail-pressure specifications
- Oil capacity, coolant capacity, and filter part numbers
- Bearing clearances and crankshaft end-play
- The emissions family and any aftertreatment. The public page says emission-certified and does not list that hardware.

If a technician needs one of those, say so. Point them to the current PSI service publication, the engine nameplate, and an authorized OEM dealer.

PSI publishes a support-case form on psiengines.com. A parts phone and email published on the PSI manuals page for other products is parts@psiengines.com and 888-331-5769. Confirm that channel still applies to 88L parts before treating it as the 88L desk.

This chat is not a PSI hotline and not a remote diagnostic tool.
$scope$,
  true,
  'Boundary note for the assistant. PSI support paths are from the public manuals page.',
  110
)
on conflict (id) do nothing;
