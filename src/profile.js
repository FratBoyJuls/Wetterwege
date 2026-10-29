/* Wetterwege – BRouter-Profilgenerator.
   Baut für jede Anfrage ein Profil, in das Sportart, Wetterlage und Vorlieben fest eingerechnet sind. */
(function (root) {
  'use strict';

  const f = (x) => (Math.round(x * 1000) / 1000).toString();
  const b = (x) => (x ? 'true' : 'false');

  // Grundkosten je Sportart (1 = ideal, größer = meiden)
  const SPORT = {
    run: {
      foot: true, turncost: 20, sigcost: 30, mud: 2.2, snow: 2.0,
      hw: { pedestrian: 1.35, living_street: 1.15, footway: 1.0, sidewalk: 1.2, path: 1.0, track: 1.0,
            bridleway: 1.25, cycleway_ok: 1.1, cycleway_no: 1.6, steps: 1.6, residential: 1.3, residential_sw: 1.2,
            service: 1.3, service_bad: 1.9, unclassified: 1.4, tertiary: 1.7, tertiary_sw: 1.35,
            secondary: 2.4, secondary_sw: 1.6, primary: 3.2, primary_sw: 2.0, trunk: 7, other: 1.6 },
      sep_sidewalk: 1.2, informal: 0.25, ford: 3,
      up: [6, 3], down: [3, 4],
    },
    walk: {
      foot: true, turncost: 0, sigcost: 15, mud: 1.8, snow: 0.8,
      hw: { pedestrian: 1.05, living_street: 1.1, footway: 1.0, sidewalk: 1.2, path: 1.0, track: 1.0,
            bridleway: 1.25, cycleway_ok: 1.25, cycleway_no: 1.8, steps: 1.2, residential: 1.35, residential_sw: 1.25,
            service: 1.35, service_bad: 1.9, unclassified: 1.5, tertiary: 1.9, tertiary_sw: 1.45,
            secondary: 2.7, secondary_sw: 1.75, primary: 3.6, primary_sw: 2.2, trunk: 8, other: 1.6 },
      sep_sidewalk: 1.2, informal: 0.2, ford: 3,
      up: [6, 3], down: [3, 4],
    },
    road: {
      foot: false, turncost: 60, sigcost: 40, mud: 3.0, snow: 6, push: 5, steps: 60,
      hw: { cycleway: 1.0, bikeroad: 1.0, residential: 1.15, living_street: 1.4, unclassified: 1.05,
            tertiary: 1.1, secondary: 1.45, secondary_cw: 1.15, primary: 2.2, primary_cw: 1.3, trunk: 4,
            service: 1.35, track: 1.25, path: 1.15, pedestrian: 2.0, footway: 1.6, bridleway: 6, other: 2.0 },
      surf: [0, 2.0, 2.5, 6, 9, 12], smooth: [1.0, 3.0], informal: 2, ford: 5, traffic: 1.0,
      up: [40, 2], down: [20, 3],
    },
    gravel: {
      foot: false, turncost: 40, sigcost: 35, mud: 2.5, snow: 4, push: 4, steps: 40,
      hw: { cycleway: 1.05, bikeroad: 1.05, residential: 1.25, living_street: 1.4, unclassified: 1.1,
            tertiary: 1.3, secondary: 1.6, secondary_cw: 1.25, primary: 2.5, primary_cw: 1.5, trunk: 5,
            service: 1.3, track: 1.0, path: 1.05, pedestrian: 2.0, footway: 1.6, bridleway: 2.5, other: 2.0 },
      surf: [0.1, 0.8, 0, 0.1, 0.35, 1.2], smooth: [0.2, 1.0], informal: 0.6, ford: 3, traffic: 0.8,
      up: [25, 2], down: [10, 4],
    },
    mtb: {
      foot: false, turncost: 20, sigcost: 30, mud: 1.5, snow: 3, push: 3, steps: 20,
      hw: { cycleway: 1.3, bikeroad: 1.3, residential: 1.5, living_street: 1.5, unclassified: 1.4,
            tertiary: 1.7, secondary: 2.2, secondary_cw: 1.6, primary: 3.5, primary_cw: 2.0, trunk: 6,
            service: 1.4, track: 1.05, path: 1.0, pedestrian: 2.2, footway: 1.6, bridleway: 1.2, other: 2.0 },
      surf: [0.25, 0.4, 0.1, 0, 0, 0.3], smooth: [0, 0], informal: 0.1, ford: 1, traffic: 0.6,
      up: [15, 3], down: [0, 5],
    },
  };

  /**
   * p = { sport, wet, snow, icy, dark, storm, heat, green, water, quiet, avoidHills, lite }
   * lite = true lässt neuere Pseudo-Tags weg (Fallback für ältere Server)
   */
  function buildProfile(p) {
    const S = SPORT[p.sport] || SPORT.run;
    const H = S.hw;
    const foot = S.foot;
    const lite = !!p.lite;
    let green = p.green || 0, water = p.water || 0;
    if (p.heat) { green = Math.max(green, 0.8); water = Math.max(water, 0.5); }
    // Formen-Modus: Formtreue geht vor Wegqualität. Vorlieben aus, Wegtypen fast gleich teuer.
    const art = !!p.art;
    if (art) { green = 0; water = 0; }
    if (p.storm) green = 0; // bei Sturm nicht in den Wald locken
    const L = [];
    const out = (s) => L.push(s);

    out('# Wetterwege – automatisch erzeugt');
    out('---context:global');
    out(`assign validForFoot = ${foot ? 1 : 0}`);
    out(`assign validForBikes = ${foot ? 0 : 1}`);
    out('assign turnInstructionMode = 0');
    out('assign processUnusedTags = false');
    out(`assign considerTurnRestrictions = ${b(!foot)}`);
    out('assign correctMisplacedViaPoints = true');
    out('assign correctMisplacedViaPointsDistance = 700');
    const up = p.avoidHills ? S.up : [0, 1.5], dn = p.avoidHills ? S.down : [0, 1.5];
    out(`assign uphillcost = ${up[0]}`);
    out(`assign uphillcutoff = ${up[1]}`);
    out(`assign downhillcost = ${dn[0]}`);
    out(`assign downhillcutoff = ${dn[1]}`);
    if (!foot) { out('assign totalMass = 85'); out('assign maxSpeed = 45'); out('assign bikerPower = 150'); }
    out(`assign c_wet = ${f(p.wet || 0)}`);
    out(`assign c_snow = ${f(p.snow || 0)}`);
    out(`assign c_icy = ${b(p.icy)}`);
    out(`assign c_dark = ${b(p.dark)}`);
    out(`assign c_storm = ${b(p.storm)}`);
    out(`assign c_green = ${f(green)}`);
    out(`assign c_water = ${f(water)}`);
    out(`assign c_quiet = ${f(art ? 0 : p.quiet || 0)}`);
    out(`assign c_art = ${b(art)}`);
    // Ampeln: Grundkosten je Sportart, per Regler bis etwa zum Sechsfachen
    const sig = p.signals == null ? 0.5 : p.signals;
    out(`assign c_sigcost = ${art ? 5 : Math.round(S.sigcost * (0.4 + 3.6 * sig))}`);

    out('---context:way');
    out('assign any_cycleroute = or route_bicycle_icn=yes or route_bicycle_ncn=yes or route_bicycle_rcn=yes route_bicycle_lcn=yes');
    out('assign any_hikeroute = or route_hiking_iwn=yes or route_hiking_nwn=yes or route_hiking_rwn=yes or route_hiking_lwn=yes or route_foot_nwn=yes or route_foot_rwn=yes route_foot_lwn=yes');
    out(`assign nodeaccessgranted = ${foot ? 'any_hikeroute' : 'or any_cycleroute lcn=yes'}`);
    out(`assign turncost = if junction=roundabout then 0 else ${art ? 0 : S.turncost}`);
    out('assign initialcost = if route=ferry then 10000 else 0');

    // Untergrund
    out(`assign surfclass =
  if surface=asphalt|paved|concrete|paving_stones|metal then 0
  else if surface=sett|cobblestone|grass_paver then 1
  else if surface=compacted|fine_gravel then 2
  else if surface=gravel|pebblestone|unpaved|rock|stone then 3
  else if surface=ground|earth|dirt|wood then 4
  else if surface=grass|mud|clay|sand then 5
  else if surface= then (
    if highway=track then (
      if tracktype=grade1 then 0 else if tracktype=grade2 then 2 else if tracktype=grade3 then 3
      else if tracktype=grade4 then 4 else if tracktype=grade5 then 5 else 3 )
    else if highway=path then 3
    else if highway=bridleway then 4
    else 0 )
  else 3`);

    out(`assign mudsus =
  if surface=asphalt|paved|concrete|paving_stones|metal then 0
  else if surface=sett|cobblestone|grass_paver then 0.05
  else if surface=compacted then 0.15
  else if surface=fine_gravel then 0.2
  else if surface=gravel|pebblestone then 0.25
  else if surface=rock|stone|wood then 0.1
  else if surface=sand then 0.2
  else if surface=unpaved then 0.55
  else if surface=ground|earth then 0.8
  else if surface=dirt then 0.85
  else if surface=grass then 0.9
  else if surface=mud|clay then 1
  else if surface= then (
    if highway=track then (
      if tracktype=grade1 then 0.05 else if tracktype=grade2 then 0.25 else if tracktype=grade3 then 0.5
      else if tracktype=grade4 then 0.8 else if tracktype=grade5 then 0.9 else 0.5 )
    else if highway=path then 0.55
    else if highway=bridleway then 0.7
    else if highway=footway then 0.15
    else 0 )
  else 0.4`);

    out('assign ismainroad = highway=residential|living_street|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link');
    out(`assign snowsus =
  if ismainroad then 0.05
  else if highway=cycleway then ( if lesser surfclass 1 then 0.35 else 0.8 )
  else if footway=sidewalk then 0.3
  else if highway=footway|pedestrian then ( if lesser surfclass 1 then 0.45 else 0.85 )
  else if highway=steps then 1
  else if greater surfclass 3 then 1
  else 0.8`);

    out(`assign mudcost = multiply ${S.mud} multiply c_wet mudsus`);
    out(`assign snowcost = multiply ${S.snow} multiply c_snow snowsus`);
    out(`assign icecost = if not c_icy then 0
  else add ( if bridge=yes|boardwalk then ${foot ? 0.2 : 0.5} else 0 )
       add ( if surface=wood|sett|cobblestone then ${foot ? 0.4 : 0.8} else 0 )
           ( if highway=steps then 1 else ( if ismainroad then 0 else ${foot ? 0.15 : 0.4} ) )`);

    out('assign islit = lit=yes|24/7|automatic|sunset-sunrise');
    if (lite) {
      out(`assign darkcost = if not c_dark then 0
  else if islit then 0
  else if lit=no then ${foot ? 1.5 : 1.0}
  else if ismainroad then 0.1
  else if or highway=pedestrian footway=sidewalk then 0.1
  else ${foot ? 1.2 : 0.8}`);
      out('assign stormcost = 0');
      out('assign greencost = 0');
      out('assign watercost = 0');
      out('assign quietcost = 0');
    } else {
      out(`assign darkcost = if not c_dark then 0
  else if islit then 0
  else add ( if lit=no then ${foot ? 1.5 : 1.0}
             else if ismainroad then 0.1
             else if or highway=pedestrian footway=sidewalk then 0.1
             else ${foot ? 1.2 : 0.8} )
           ( if estimated_forest_class=5|6 then 0.3 else 0 )`);
      out(`assign stormcost = if not c_storm then 0
  else if estimated_forest_class=3 then 0.6
  else if estimated_forest_class=4 then 1.0
  else if estimated_forest_class=5 then 1.5
  else if estimated_forest_class=6 then 2.0
  else 0`);
      out(`assign nogreen =
  if estimated_forest_class= then 0.6
  else if estimated_forest_class=1 then 0.45
  else if estimated_forest_class=2 then 0.35
  else if estimated_forest_class=3 then 0.25
  else if estimated_forest_class=4 then 0.15
  else if estimated_forest_class=5 then 0.08
  else 0`);
      out('assign greencost = multiply c_green nogreen');
      out(`assign nowater =
  if estimated_river_class= then 0.4
  else if estimated_river_class=1 then 0.3
  else if estimated_river_class=2 then 0.22
  else if estimated_river_class=3 then 0.15
  else if estimated_river_class=4 then 0.08
  else if estimated_river_class=5 then 0.03
  else 0`);
      out('assign watercost = multiply c_water nowater');
      if (foot) {
        out(`assign noisy =
  if estimated_noise_class=1 then 0.15
  else if estimated_noise_class=2 then 0.3
  else if estimated_noise_class=3 then 0.5
  else if estimated_noise_class=4 then 0.8
  else if estimated_noise_class=5 then 1.1
  else if estimated_noise_class=6 then 1.4
  else 0`);
      } else {
        out(`assign noisy = add
  ( if estimated_traffic_class=1|2 then 0.05
    else if estimated_traffic_class=3 then 0.15
    else if estimated_traffic_class=4 then 0.3
    else if estimated_traffic_class=5 then 0.5
    else if estimated_traffic_class=6|7 then 0.8
    else 0 )
  ( if estimated_noise_class=5|6 then 0.2 else 0 )`);
      }
      out('assign quietcost = multiply c_quiet noisy');
    }

    // Zugang
    out(`assign defaultaccess =
  if access= then not motorroad=yes
  else if access=private|no|customers|delivery|military|psv then false
  else true`);
    out(`assign footaccess =
  if foot=private|no|use_sidepath then false
  else if foot=yes|designated|permissive then true
  else if bicycle=dismount then true
  else if sidewalk=both|left|right|yes then true
  else defaultaccess`);
    out(`assign bikeaccess =
  if bicycle= then (
    if bicycle_road=yes then true
    else if vehicle= then ( if highway=footway|pedestrian then false else defaultaccess )
    else not vehicle=private|no )
  else not bicycle=private|no|dismount|use_sidepath`);

    out('assign forbidden = or ( and highway= not route=ferry ) or highway=motorway|motorway_link|proposed|abandoned|construction|platform|raceway|bus_stop|busway route=ferry');
    out('assign sacbad = sac_scale=demanding_mountain_hiking|alpine_hiking|demanding_alpine_hiking|difficult_alpine_hiking');

    if (foot) {
      out('assign hassidewalk = sidewalk=both|left|right|yes');
      out('assign sepsidewalk = sidewalk=separate');
      out(`assign hwcost =
  if highway=pedestrian then ${H.pedestrian}
  else if highway=living_street then ${H.living_street}
  else if highway=footway then ( if footway=sidewalk then ${H.sidewalk} else ${H.footway} )
  else if highway=path then ${H.path}
  else if highway=track then ( if tracktype=grade4 then add ${H.track} 0.1 else if tracktype=grade5 then add ${H.track} 0.25 else ${H.track} )
  else if highway=bridleway then ${H.bridleway}
  else if highway=cycleway then ( if foot=yes|designated|permissive then ${H.cycleway_ok} else ${H.cycleway_no} )
  else if highway=steps then ${H.steps}
  else if highway=residential then ( if hassidewalk then ${H.residential_sw} else ${H.residential} )
  else if highway=service then ( if service=parking_aisle|drive-through|parking then ${H.service_bad} else ${H.service} )
  else if highway=unclassified then ${H.unclassified}
  else if highway=tertiary|tertiary_link then ( if hassidewalk then ${H.tertiary_sw} else ${H.tertiary} )
  else if highway=secondary|secondary_link then ( if hassidewalk then ${H.secondary_sw} else ${H.secondary} )
  else if highway=primary|primary_link then ( if hassidewalk then ${H.primary_sw} else ${H.primary} )
  else if highway=trunk|trunk_link then ( if hassidewalk then ${H.primary} else ${H.trunk} )
  else ${H.other}`);
      out(`assign extracost =
  add ( if sepsidewalk then ${S.sep_sidewalk} else 0 )
  add ( if informal=yes then ${S.informal} else 0 )
  add ( if ford=yes|stepping_stones then ${S.ford} else 0 )
      ( if sacbad then 3 else if sac_scale=mountain_hiking then 0.5 else 0 )`);
      out('assign accesspenalty = if footaccess then 0 else 10000');
      out('assign onewaypenalty = 0');
    } else {
      const SF = S.surf;
      out(`assign hascycleway = not
  and ( or cycleway= cycleway=no|none ) and ( or cycleway:left= cycleway:left=no ) and ( or cycleway:right= cycleway:right=no ) ( or cycleway:both= cycleway:both=no )`);
      out(`assign hwcost =
  if or bicycle_road=yes cyclestreet=yes then ${H.bikeroad}
  else if highway=cycleway then ${H.cycleway}
  else if highway=residential then ${H.residential}
  else if highway=living_street then ${H.living_street}
  else if highway=unclassified then ${H.unclassified}
  else if highway=tertiary|tertiary_link then ${H.tertiary}
  else if highway=secondary|secondary_link then ( if hascycleway then ${H.secondary_cw} else ${H.secondary} )
  else if highway=primary|primary_link then ( if hascycleway then ${H.primary_cw} else ${H.primary} )
  else if highway=trunk|trunk_link then ( if bicycle=yes|designated then ${H.trunk} else 10000 )
  else if highway=service then ( if service=parking_aisle|drive-through|parking then add ${H.service} 0.6 else ${H.service} )
  else if highway=track then ${H.track}
  else if highway=path then ${H.path}
  else if highway=pedestrian then ${H.pedestrian}
  else if highway=footway then ${H.footway}
  else if highway=bridleway then ${H.bridleway}
  else if highway=steps then ${S.steps}
  else ${H.other}`);
      out(`assign surfcost =
  if equal surfclass 0 then ${SF[0]}
  else if equal surfclass 1 then ${SF[1]}
  else if equal surfclass 2 then ${SF[2]}
  else if equal surfclass 3 then ${SF[3]}
  else if equal surfclass 4 then ${SF[4]}
  else ${SF[5]}`);
      out(`assign smoothcost =
  if smoothness=bad|poor|rough then ${S.smooth[0]}
  else if smoothness=very_bad|horrible|very_horrible|impassable|off_road_wheels|high_clearance then ${S.smooth[1]}
  else 0`);
      const mtbx = p.sport === 'mtb' ? [0, 0, 0, 1, 5] : p.sport === 'gravel' ? [0, 0.5, 2, 8, 8] : [0, 2, 6, 10, 10];
      out(`assign mtbcost =
  if mtb:scale=0 then ${mtbx[0]}
  else if mtb:scale=1|1+|1- then ${mtbx[1]}
  else if mtb:scale=2|2+|2- then ${mtbx[2]}
  else if mtb:scale=3 then ${mtbx[3]}
  else if mtb:scale=4|5|6 then ${mtbx[4]}
  else ( if sacbad then 6 else 0 )`);
      out('assign slipcost = if surface=wood|sett|cobblestone then multiply 0.5 c_wet else 0');
      out(`assign extracost =
  add surfcost add smoothcost add mtbcost add slipcost
  add ( if informal=yes then ${S.informal} else 0 )
      ( if ford=yes|stepping_stones then ${S.ford} else 0 )`);
      out(`assign footaccess2 = if foot=private|no|use_sidepath then false else defaultaccess`);
      out(`assign accesspenalty =
  if bikeaccess then 0
  else if footaccess2 then ${S.push}
  else if any_cycleroute then 15
  else 10000`);
      out(`assign badoneway =
  if reversedirection=yes then (
    if oneway:bicycle=yes then true
    else if oneway= then junction=roundabout
    else oneway=yes|true|1 )
  else oneway=-1`);
      out(`assign onewaypenalty =
  if badoneway then (
    if oneway:bicycle=no then 0
    else if cycleway=opposite|opposite_lane|opposite_track then 0
    else if or cycleway:left:oneway=no|-1 cycleway:right:oneway=no|-1 then 0
    else if junction=roundabout|circular then 60
    else if highway=primary|primary_link then 50
    else if highway=secondary|secondary_link then 30
    else if highway=tertiary|tertiary_link then 20
    else 4 )
  else 0`);
    }

    out(`assign costfactor =
  if forbidden then 10000
  else if greater accesspenalty 9999 then 10000
  else min 9999
    add ( if c_art then add 0.7 multiply 0.3 hwcost else hwcost )
    add extracost
    add mudcost
    add snowcost
    add icecost
    add darkcost
    add stormcost
    add greencost
    add watercost
    add quietcost
        max onewaypenalty accesspenalty`);

    // Tags, die in der Antwort mitgeliefert werden sollen
    out('assign dummyUsage = or smoothness= or lit= or tracktype= or bridge= or surface= highway=');

    out('---context:node');
    out(`assign defaultaccess =
  if access= then true
  else if access=private|no then false
  else true`);
    out(`assign bikeaccess =
  if nodeaccessgranted=yes then true
  else if bicycle= then ( if vehicle= then defaultaccess else not vehicle=private|no )
  else not bicycle=private|no|dismount`);
    out(`assign footaccess =
  if bicycle=dismount then true
  else if foot= then defaultaccess
  else not foot=private|no`);
    out('assign signals = or highway=traffic_signals crossing=traffic_signals');
    // Ungesicherte Querung einer Haupt- oder Bundesstraße (BRouter-Schätzung 1 = harmlos bis 6 = gefährlich)
    out(lite ? 'assign crossrisk = 0' : `assign crossrisk =
  if estimated_crossing_class=1 then 10
  else if estimated_crossing_class=2 then 30
  else if estimated_crossing_class=3 then 70
  else if estimated_crossing_class=4 then 130
  else if estimated_crossing_class=5 then 220
  else if estimated_crossing_class=6 then 350
  else 0`);
    if (foot) {
      out(`assign initialcost =
  if not footaccess then 1000000
  else if signals then c_sigcost
  else crossrisk`);
    } else {
      out(`assign initialcost =
  if bikeaccess then (
    if signals then c_sigcost
    else if barrier=stile|kissing_gate|turnstile|cycle_barrier then 40
    else crossrisk )
  else if footaccess then 100
  else 1000000`);
    }
    return L.join('\n') + '\n';
  }

  const api = { buildProfile, SPORT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WWProfile = api;
})(typeof window !== 'undefined' ? window : globalThis);
