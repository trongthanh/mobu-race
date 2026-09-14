Create a Three.js 3D race game (think duck race, wheel of name, random picker) with these requirements:

- The art direction must follow the cosy tree-top-view game as sampled in @ref/ screenshots
- The characters for the race are mobu (refer to @ref/mobu* images from different angle), and the run on a country side dirt track. Note that, mobu is a human with enomous lips.
- This is a real time racing game, with the first user as control host.
- The host can assign to another visitor.
- Before the race, the host will setup the number of racer by input a list of name in a text field, each name on a line.
- The host can also set time for the race. That will decide the length of the track.
- Allow user change camera angle during the race while following the lead runner
- Make the race dramatic by randomly changing the lead during the race
- Add an avatar to the scene for any realtime visitor. Let them choose screen name (follow overhead). They will be the race watcher.

For technical requirement:
- The winner is randomize just like other race game, decided by the server.
- Back end is node.js, realtime with web socket
- For now, there is just one race from the host (but we might add the lobby and room later)


