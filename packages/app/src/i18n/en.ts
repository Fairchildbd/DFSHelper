export const en = {
  'app.tab.week': 'This Week',
  'app.tab.bestball': 'Best Ball',
  'app.tab.rankings': 'Rankings',
  'app.tab.about': 'About',
  'app.back.matchup': 'Matchup',
  'app.back.week': 'This Week',
  'app.back.rankings': 'Rankings',

  'api.requestFailed': '{{status}} {{statusText}} — {{url}}',

  'error.unreachableTitle': 'Can’t reach the API',
  'error.expectingServer': 'Expecting the server at {{url}}. Start it with <command>npm run api</command>.',
  'error.expectingServerLan':
    'Expecting the server at {{url}}. Start it with <command>npm run api</command>, or set <envVar>EXPO_PUBLIC_API_URL</envVar> to your machine’s LAN address if you’re on a physical device.',
  'error.expectingServerMatchups':
    'Expecting the server at {{url}}. Start it with <command>npm run api</command>, and make sure <matchupCommand>npm run db:matchups</matchupCommand> has been run at least once.',
  'error.retry': 'Retry',

  'confidence.full': 'Full workout',
  'confidence.most': 'Most drills',
  'confidence.partial': 'Partial',
  'confidence.sparse': 'Sparse',
  'confidence.none': 'No workout',

  'kickoff.dateAndTime': '{{date}} · {{time}}',
  'kickoff.eastern': '{{hour}}:{{minute}} {{meridiem}} ET',
  'kickoff.am': 'AM',
  'kickoff.pm': 'PM',

  'shape.shootout.title': 'Shootout',
  'shape.shootout.blurb':
    'Real scoring, and both offenses can get to it. Games to stack.',
  'shape.oneSided.title': 'Points, but one-sided',
  'shape.oneSided.blurb':
    'The scoring is there and one team carries it. A side to attack, not a game to stack.',
  'shape.lowScoring.title': 'Low-scoring',
  'shape.lowScoring.blurb':
    'Not much projected, and no defense to credit for it — these offenses simply cannot move.',
  'shape.defensive.title': 'Defensive games',
  'shape.defensive.blurb':
    'Quiet because the defenses are good. The mismatches here are real, but they favour the defense.',

  'matchup.noGradeableMismatch': 'No gradeable mismatch',
  'matchup.edgeFor': '{{offense}} has the edge on {{defense}}',
  'matchup.edgeAgainst': '{{defense}} shuts down {{offense}}',

  'tendency.percent': '{{value}}%',
  'tendency.seconds': '{{value}}s',
  'tendency.sourceCoach': '{{coach}}’s own record',
  'tendency.coachFallback': 'Coach',
  'tendency.sourceTeam': 'New staff — showing the team’s recent profile',
  'tendency.sourceLeague': 'League average — no profile available',

  'row.final': 'Final',
  'row.coachVsCoach': ' · {{away}} vs {{home}}',
  'row.gradedAfterTheFact': ' · graded after the fact',
  'row.noFantasyLines': 'No fantasy lines recorded',
  'row.top10Hits': '{{hits}} of our top 10 finished in the real top 10',
  'row.mismatchSummary_one': '{{count}} mismatch · gap {{gap}}',
  'row.mismatchSummary_other': '{{count}} mismatches · gap {{gap}}',
  'row.totalLine': ' · total {{total}}',
  'row.noLineYet': ' · no line yet',
  'row.captionPredicted': 'predicted',
  'row.captionGap': 'gap',
  'row.captionScoring': 'scoring',

  'player.freeAgent': 'FA',
  'player.age': '{{age}}yr',
  'player.experience': '{{years}} exp',
  'player.spotStarter': 'Spot starter',
  'player.backupNoStarts': 'Backup — no starts',
  'player.tooFewSnaps': 'Too few snaps to rank',
  'player.metaSeparator': ' · ',

  'split.workout': 'workout',
  'split.college': 'college',
  'split.nfl': 'NFL',
  'split.legendEntry': '{{percent}}% {{label}}',

  'rankings.title': 'Rankings',
  'rankings.subtitle': '{{total}} players · composite score',
  'rankings.searchPlaceholder': 'Search players',
  'rankings.allPositions': 'All',
  'rankings.empty': 'No players match that filter.',

  'bestball.title': 'Best Ball',
  'bestball.subtitle': 'Week {{week}} · {{games}} games · sorted by mismatch',
  'bestball.loadingSchedule': 'Loading schedule…',
  'bestball.noKickoffNotice':
    'No game this week has kicked off. Every number here is built from prior seasons, so a team that has changed coaches or personnel may not resemble its profile.',
  'bestball.empty':
    'No predictions for this week yet. The weekly job only builds the week in play — for the whole season, run <command>npm run db:matchups:bestball</command>.',

  'week.title': 'This week',
  'week.subtitle': '{{games}} games · grouped by what kind of game it is',
  'week.noUpcoming': 'No upcoming week',
  'week.forecastNotice':
    'Nothing has kicked off yet, so every number here is a forecast built from prior seasons. Predictions are frozen once a game goes final, so what you see now is what gets graded next week.',
  'week.noPredictions': 'No predictions built for this week yet. Run <command>npm run db:matchups</command>.',
  'week.resultsTitle': '{{label}} · results',
  'week.resultsSubtitle': 'What was ranked, against what actually happened',
  'week.backfilledNotice':
    'These grades were produced after the game was played, as a worked example — not a forecast the model made in advance. Weeks predicted ahead of kickoff will be marked as such.',
  'week.ungradedTitle': 'Not graded',
  'week.ungradedBlurb':
    'Not enough roster or opponent data to say what kind of game this is.',
  'week.noMainSlate':
    'No main-slate salaries imported for this week. A showdown is loaded, and it builds from its own game below. For the main slate, export it from the contest lobby and run <command>npm run ingest:dk -- --file DKSalaries.csv</command>.',
  'week.noSalaries':
    'No DraftKings salaries imported for this week, so no lineup can be built. Export the slate from the contest lobby and run <command>npm run ingest:dk -- --file DKSalaries.csv</command>.',
  'week.slateLabel_one': 'Main slate · {{count}} game · {{players}} priced',
  'week.slateLabel_other': 'Main slate · {{count}} games · {{players}} priced',
  'player.freeAgentLong': 'Free agent',
  'player.ageYears': '{{age}} yrs old',
  'player.seasons_one': '{{count}} season',
  'player.seasons_other': '{{count}} seasons',
  'player.composite': 'Composite',
  'player.positionRank': '{{position}} rank',
  'player.overallRank': 'Overall',
  'player.rankValue': '#{{value}}',
  'player.noRecentProduction':
    'No NFL production on record for this player in the scoring window. After four seasons the league\u2019s own usage is the verdict, so this score reflects absence of production rather than a graded performance \u2014 the workout below is shown for reference but does not feed the ranking.',
  'player.lowSignalMeasurables':
    'Quarterback combine drills measure mobility, not the throwing traits that decide the position. This score leans on production by design.',
  'player.lowSignalProduction':
    'No public feed grades individual offensive line play. The production figure below is snap share \u2014 availability and trust, not blocking quality.',
  'player.athleticTitle': 'Athletic',
  'player.athleticSubtitle': 'Position-weighted combine percentiles',
  'player.collegeTitle': 'College',
  'player.collegeSubtitle': 'Per-game rates at the previous level',
  'player.productionTitle': 'Production',
  'player.productionSubtitle': 'Per-game rates, recent seasons',
  'player.rawWorkout': 'Raw workout',
  'player.rawSchool': '· {{school}}',
  'player.noDrills': 'No drills recorded',
  'player.confidenceLine': '{{label}} · {{recorded}}% recorded · {{weight}}% of this ranking',
  'player.shrinkNote':
    'This score covers only what was recorded, undiscounted. The {{unmeasured}}% that wasn\u2019t measured simply carries less weight \u2014 it is never held against the player.',
  'player.metricWeight': '{{weight}}%',
  'player.metricRaw': '{{value}}{{unit}}',
  'player.notRecorded': 'not recorded',
  'player.percentile': '{{percentile}}th percentile',

  'drill.unit.seconds': 's',
  'drill.unit.reps': ' reps',
  'drill.unit.inches': '"',
  'drill.forty': '40: {{value}}',
  'drill.bench': 'Bench: {{value}}',
  'drill.vertical': 'Vert: {{value}}"',
  'drill.broad': 'Broad: {{value}}"',
  'drill.cone': '3C: {{value}}',
  'drill.shuttle': 'Shuttle: {{value}}',
  'lineup.showdownTitle': 'Showdown captain',
  'lineup.gamePrefix': '{{label}} · ',
  'lineup.showdownSubtitle':
    'one captain at 1.5x salary and 1.5x points, five flex.',
  'lineup.showdownNote':
    'Three entries rather than one, because six players from a single game share a ball and a scoreboard: one betting on each offense having the day, and one for a game that never gets going. Two receivers from a team at most, and never without their quarterback \u2014 a third and fourth receiver are competing with the first two for the same throws.',
  'lineup.classicSubtitle': 'Millionaire Maker · QB, 2 RB, 3 WR, TE, FLEX, DST.',
  'lineup.stackingTitle': 'Stacking {{game}}',
  'lineup.stackedPlayers': '{{count}} of the nine from this game',
  'lineup.stackMismatch': ' · mismatch {{score}}, the highest on the slate',
  'lineup.cannotBuild': 'Can’t build a lineup',
  'lineup.cannotBuildThisOne': 'Can’t build this one',
  'lineup.nothingToBuild': 'Nothing to build from',
  'lineup.poolMeta': '{{pool}} in the pool · defense rates from {{season}}',
  'lineup.unavailable': ' · {{count}} out or on IR',
  'lineup.ungraded': ' · {{count}} ungraded',
  'lineup.dropsAndLocksAll': ' · {{dropped}} dropped, {{locked}} locked across all three',
  'lineup.reset': 'Reset',
  'lineup.avgMatchup': 'Avg matchup',
  'lineup.salary': 'Salary',
  'lineup.leftOver': 'Left over',
  'lineup.money': '${{amount}}',
  'lineup.leftoverNote':
    'Money left unspent is matchup edge left unbought. It usually means the pool is thin at a position \u2014 check that the salary file covers the whole slate.',
  'lineup.shootout': 'Shootout',
  'lineup.lowScoring': 'Low-scoring',
  'lineup.scenarioQuestion': 'How do you think this game goes?',
  'lineup.allScenarios': 'All four',
  'lineup.readLead': 'Model’s read: {{scenario}}.',
  'lineup.readLeadSlight': 'Model’s read, slightly: {{scenario}}.',
  'lineup.noReadLead': 'No read.',
  'lineup.noReadBody':
    'The lanes in this game are too even, or too thinly graded, to say which way it goes \u2014 which is itself a reason to spread across all four rather than pick one.',
  'lineup.pickTeam': '{{position}} · {{team}}',
  'lineup.lock': 'Lock',
  'lineup.locked': 'Locked',
  'lineup.drop': 'Drop',
  'matchup.back': 'Matchups',
  'matchup.unit.offense': 'Off',
  'matchup.unit.defense': 'DEF',
  'matchup.unit.special': 'SPT',
  'matchup.unitChip': '{{team}} {{unit}}',
  'matchup.unitTitle.offense': 'starting offense',
  'matchup.unitTitle.defense': 'starting defense',
  'matchup.unitTitle.special': 'starting special teams',
  'matchup.unitTitle.fallback': 'starters',
  'matchup.skillPositions': 'Skill Positions',
  'matchup.starterListTitle': '{{team}} {{unit}}',
  'matchup.gradedPlayers': 'Graded players, against what they scored',
  'matchup.bestMatchups': 'Best matchups',
  'matchup.stadium': ' · {{stadium}}',
  'matchup.finalScore': 'FINAL {{away}} {{awayScore}} – {{homeScore}} {{home}}',
  'matchup.predictedPrefix': 'predicted ',
  'matchup.heroLabel_one': 'mismatch score · {{count}} lane past the {{threshold}}-point bar',
  'matchup.heroLabel_other': 'mismatch score · {{count}} lanes past the {{threshold}}-point bar',
  'matchup.buildShowdown': 'Build showdown captain lineup',
  'matchup.buildShowdownMeta':
    '{{players}} priced for this game · captain at 1.5x salary and 1.5x points',
  'matchup.noFantasyLines': 'No fantasy lines were recorded for this game.',
  'matchup.top10Hits':
    '{{hits}} of the ten highest-graded players finished in the game’s real top ten.',
  'matchup.backfilledCaveat':
    'Graded after the fact. This prediction was generated from a model whose inputs already include this game, so treat it as a worked example rather than as a forecast that was actually made in advance.',
  'matchup.talentGap': 'Talent gap {{gap}} · scoring {{scoring}}',
  'matchup.notGraded': 'not graded',
  'matchup.leaning': ', leaning {{team}}',
  'matchup.evenlySplit': ', evenly split',
  'matchup.vegasLine': ' (total {{total}}{{spread}})',
  'matchup.spread': ', spread {{spread}}',
  'matchup.noBettingLine':
    'No betting line published yet. The talent gap is unaffected; the scoring read is built from the units and pace alone.',
  'matchup.coachingStaffs': 'Coaching staffs',
  'matchup.laneEdges': 'Lane edges',
  'matchup.laneEdgesHint':
    'Each unit’s percentile against the same unit league-wide, minus how well the opponent defends it. Positive favours the offense.',
  'matchup.edgeSub': '{{lane}} · unit {{offense}} vs defense {{defense}}',
  'matchup.noRankedSpecialists': 'Nobody on this unit carries a ranking yet.',
  'matchup.noDepthChart': 'No depth chart published for this team yet.',
  'matchup.startersHint':
    'One player per slot on the published depth chart. Backups are not listed, and the number is his overall ranking score.',
  'matchup.startersHintSpecial':
    ' Kickers, punters and snappers are not ranked yet, so they are held back.',
  'matchup.unknownCoach': 'Unknown',
  'matchup.coachGames': ' · {{games}}g',
  'matchup.offense': 'Offense',
  'matchup.defense': 'Defense',
  'matchup.rankOf': '{{rank}} of {{total}}',
  'matchup.notRanked': 'Not ranked',
  'matchup.playerMeta': '{{team}} · {{position}} · {{lane}}',
  'matchup.notGradeable': 'Matchup not gradeable',
  'matchup.playerEdge': '{{edge}} unit edge · {{ranking}} · {{volume}} volume',
  'matchup.unranked': 'unranked',
  'matchup.rankingScore': '{{score}} ranking',
  'matchup.scoredPpr': 'Scored {{points}} PPR',
  'matchup.rankedFinished': ' · ranked #{{predicted}}, finished #{{actual}}',
  'matchup.schemeCaveat': 'Scheme profile is the team’s, not this staff’s',
  'matchup.starterRank': ' · {{rank}}',

  'ordinal.st': '{{n}}st',
  'ordinal.nd': '{{n}}nd',
  'ordinal.rd': '{{n}}rd',
  'ordinal.th': '{{n}}th',

  'stat.line': ' · {{line}}',
  'stat.passYards': '{{yards}} pass yd',
  'stat.rushYards': '{{yards}} rush yd',
  'stat.receptions': '{{receptions}}/{{targets}} rec',
  'stat.receivingYards': '{{yards}} rec yd',
  'stat.touchdowns': '{{tds}} TD',
  'about.title': 'About',
  'about.subtitle': 'What every number here means',
  'about.lede':
    'A player’s ranking says how good he is. His coach’s tendencies say how he will be <em>used</em>. The opponent’s profile says how much that usage is worth this week. A mismatch is where those three disagree in the offense’s favour \u2014 and this app is a way of finding them.',


  'about.lanes.title': 'Lanes',
  'about.lanes.hint': 'The unit-vs-unit matchups a game is broken into',
  'about.lanes.body':
    'Every game is decomposed into {{lanes}} lanes, each graded in <em>both</em> directions \u2014 each offense against the other defense. So a full game has {{edges}} lane edges, not {{lanes}}.',
  'about.lanes.note':
    'These are fantasy-shaped rather than football-shaped: there is no linebacker-corps lane, because no lineup decision hangs on one.',

  'about.laneEdge.title': 'Lane edge',
  'about.laneEdge.hint': 'One lane’s verdict, from −100 to +100',
  'about.laneEdge.formulaUnit': 'unit percentile',
  'about.laneEdge.formulaSuppression': '− opponent’s suppression',
  'about.laneEdge.formulaUsage': '+ usage tilt',
  'about.laneEdge.formulaResult': 'edge',
  'about.laneEdge.body':
    'Both sides are percentiles against the other 31 teams in that same lane, so the subtraction is like-for-like and the result already lives on a 0–100 scale. The unit figure is role-weighted \u2014 a first receiver counts double a second, and so on down \u2014 so a lane is not flattened by depth nobody plays.',
  'about.laneEdge.coachTerm':
    'The last term is the coach. A staff that force-feeds tight ends makes a tight-end mismatch matter more. It is capped at ±{{cap}} percentile points on purpose: scheme decides how often an edge gets targeted, not whether it exists.',

  'about.sign.title': 'Reading the sign',
  'about.sign.hint': 'Which way a lane edge points',
  'about.sign.body':
    'An edge is <em>signed</em>, and the sign is the whole direction of the matchup:',
  'about.sign.positive': 'positive',
  'about.sign.positiveBody':
    'The <em>offense</em> holds the advantage. Its unit grades out above what the defense suppresses.',
  'about.sign.negative': 'negative',
  'about.sign.negativeBody':
    'The <em>defense</em> holds the advantage. The opponent suppresses this lane better than the offense runs it.',
  'about.sign.warn':
    'A negative edge is not a weak signal \u2014 it is a strong one pointing the other way. Past −{{bar}} it says fade this unit, with the same conviction that +{{bar}} says play it. That is why both extremes are coloured and only the even middle goes grey.',
  'about.sign.trap':
    'The trap is reading a negative as a verdict on the offense. It is not. An edge is a <em>difference</em>, and a small negative usually means both units are good:',
  'about.sign.rowsNote':
    'The list rows say this in words rather than signs, because a bare “−3” tells you the opposite of the truth if you read it as a grade.',

  'about.example.runGame': 'Run game vs front seven',
  'about.example.runGameReading':
    'Even. An elite run game meeting an elite front \u2014 not a weakness, and not a spot. Nowhere near the bar, so it counts for nothing.',
  'about.example.tightEnds': 'Tight ends vs coverage',
  'about.example.tightEndsReading':
    'A real mismatch, and the advantage is the defense’s. Past the bar, so it counts \u2014 and it says avoid this unit, not ignore this lane.',
  'about.example.unitVsDefense': 'unit {{unit}} vs defense {{defense}}',

  'about.scale.head': 'The full ramp',
  'about.scale.highLabel': '+{{bar}} and up',
  'about.scale.leanOffenseLabel': '+20 to +{{bar}}',
  'about.scale.evenLabel': '−20 to +20',
  'about.scale.leanDefenseLabel': '−20 to −{{bar}}',
  'about.scale.lowLabel': '−{{bar}} and down',
  'about.scale.advantageOffense': 'Advantage, offense',
  'about.scale.leanOffense': 'Lean offense',
  'about.scale.even': 'Even',
  'about.scale.leanDefense': 'Lean defense',
  'about.scale.advantageDefense': 'Advantage, defense',

  'about.bar.title': 'The {{bar}}-point bar',
  'about.bar.hint': 'What turns an edge into a mismatch',
  'about.bar.body':
    '“{n} lanes past the {{bar}}-point bar” counts how many of the {{edges}} edges have a magnitude of {{bar}} or more. It is an <em>absolute</em> count, so those lanes are not necessarily in the same team’s favour \u2014 a game where both offenses have clean spots reads the same as one team having all of them. The lane list on the matchup screen is where the direction lives.',
  'about.bar.percentile':
    'The bar sits at the 75th percentile of lane edges observed across a full season, so a typical game has about three and roughly one game in 27 has none. That is the point: a slate where every game has mismatches is a slate where the word has stopped carrying information.',
  'about.bar.ungraded':
    'Lanes that can’t be graded \u2014 missing roster or opponent data \u2014 are dropped from the count entirely rather than scored as neutral. A game short on data can quietly be 5 of 8 while presenting the same as 5 of {{edges}}.',

  'about.mismatch.title': 'Mismatch score',
  'about.mismatch.hint': 'How large the talent gaps are',
  'about.mismatch.rms':
    'Built in two steps. First the {{topEdges}} largest edges are combined by root-mean-square \u2014 not averaged across all {{edges}}, because one severe mismatch is a better spot than four mild ones, and averaging would let neutral lanes bury the single exploitable one.',
  'about.mismatch.direction':
    'Direction counts. A lane the defense wins is real information, but it says fade rather than play, and fading scores no fantasy points \u2014 so it enters at {{weight}}% weight. A defense has to be roughly twice as dominant to outrank an offense. Not zero, because a one-sided beating still concentrates whatever scoring happens on the side doing the beating.',
  'about.mismatch.noScaling':
    'Nothing scales it. An earlier version multiplied the score by a capped game-environment term, which made one number a blend of two questions and a clean answer to neither \u2014 and, because lookahead lines only exist a few weeks out, ranked half a slate by a different formula from the other half. Scoring lives in its own score now.',

  'about.worked.head': 'Worked example',
  'about.worked.rms': 'edges {{edges}} → RMS = <num>{{rms}}</num>',
  'about.worked.defenseCounts': 'a lane the defense wins by 80 counts <num>{{counted}}</num>, not 80',
  'about.worked.mismatchTotal': 'mismatch score = <total>{{score}}</total>',
  'about.worked.shootoutInputs':
    'total {{total}}, offenses {{strong}}/{{weak}}, defenses {{defense}}, pace {{pace}}',
  'about.worked.shootoutTotal': 'shootout score = <total>{{score}}</total>',

  'about.shootout.title': 'Shootout score',
  'about.shootout.hint': 'Where the points are, which is a different question',
  'about.shootout.body':
    'The mismatch score asks where the largest talent gap is. It does not ask whether anyone in the game will score. A great defense strangling a bad offense is an enormous mismatch and a dead slate; two ordinary offenses behind two broken lines with a 48.5 total is a modest mismatch and a live one. Both belong on the weekly list, so they get one score each \u2014 and the list groups by this one, because what a game is worth doing with matters more than where it places on a ladder.',
  'about.shootout.vegasTotal': 'Vegas total',
  'about.shootout.vegasTotalNote': 'A market price on the whole game',
  'about.shootout.offenses': 'Both offenses',
  'about.shootout.offensesNote': 'Weighted toward the weaker one \u2014 a shootout needs two',
  'about.shootout.defenses': 'Both defenses',
  'about.shootout.defensesNote': 'How exploitable the two units are, across every lane',
  'about.shootout.pace': 'Combined pace',
  'about.shootout.paceNote': 'Snaps are the raw material; faster is more of them',
  'about.shootout.totalLeads':
    'The total leads because it is a market price on the whole game, scaled from {{floor}} to {{ceiling}}. The other three earn their place because the market prices points, not fantasy points: it is indifferent to whether the scoring is concentrated in one offense. So the weaker of the two offenses carries {{weakerWeight}}% of the offensive component \u2014 a shootout needs both teams to score, and one great offense against one broken one is a blowout with a single usable side.',
  'about.shootout.sections':
    'The score and the lean together sort every game into one of four sections. A game that clears {{floor}} projects real scoring, and whether the two offenses are within {{tolerance}} percentile points of each other decides whether it is a <em>shootout</em> to stack or <em>points, but one-sided</em> \u2014 a single side to attack. Below that the game is quiet, and the only useful thing left to say is why: two units that genuinely stop people make it a <em>defensive game</em>, and anything else is <em>low-scoring</em>, which is the worse of the two \u2014 nobody stopped anybody, these offenses just cannot move.',
  'about.shootout.noTotal':
    'A game with no published total is scored on the remaining three components rather than treated as neutral. And note that this is scoring, not weather: roof, surface, rest and travel are a separate question this score does not ask.',

  'about.playerScore.title': 'Player matchup score',
  'about.playerScore.hint': 'How good the spot is \u2014 not how good the player is',
  'about.playerScore.body': 'Each graded player gets a 0–100 score blending three factors:',
  'about.playerScore.matchupEdge': 'Matchup edge',
  'about.playerScore.matchupEdgeNote': 'His lane, this week',
  'about.playerScore.quality': 'Player quality',
  'about.playerScore.qualityNote': 'Season-long ranking composite',
  'about.playerScore.volume': 'Projected volume',
  'about.playerScore.volumeNote': 'Scheme pace and target share for his role',
  'about.playerScore.laneLeads':
    'The lane edge leads deliberately. This grade answers “how good is this spot” \u2014 the Rankings tab already answers “how good is this player”, and a great player in a terrible spot is exactly what a DFS tool has to be able to say out loud.',
  'about.playerScore.missingFactor':
    'A missing factor reduces the weight rather than scoring zero: absence is uncertainty, not a finding. The confidence figure under each player is how much of the intended weight actually survived.',

  'about.caveats.title': 'What these numbers don’t say',
  'about.caveats.hint': 'Worth knowing before you act',
  'about.caveats.ordinal':
    'A mismatch score is <em>ordinal</em>, not a projection. It says how lopsided a game’s worst lanes are \u2014 nothing in it predicts a final score or a point total.',
  'about.caveats.withinSlate':
    'It ranks within a slate. Two games can have near-identical edge scores and separate only on the environment multiplier, which means Vegas broke the tie, not the units.',
  'about.caveats.edgeCount':
    'Edge count and mismatch score measure different things. Only the top {{topEdges}} edges feed the score, so a {{nextEdge}}th lane past the bar raises the count without moving the number above it.',
  'about.caveats.coachKeyed':
    'Coaching profiles are keyed to the coach, not the team. When a staff is new the screen falls back to the franchise’s recent past and labels itself as doing so.',
  'about.caveats.frozen':
    'Predictions are frozen at kickoff. Anything graded after a game was played is marked as a worked example, not a forecast the model made in advance.',
} satisfies Record<string, string>;
