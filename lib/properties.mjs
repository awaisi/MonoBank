export const GROUPS = {
  brown: { name: 'Brown', color: '#8b5a3c' },
  lightblue: { name: 'Light Blue', color: '#9ad8e8' },
  pink: { name: 'Pink', color: '#d65aa3' },
  orange: { name: 'Orange', color: '#ef8b35' },
  red: { name: 'Red', color: '#d94345' },
  yellow: { name: 'Yellow', color: '#f0ca3e' },
  green: { name: 'Green', color: '#31966f' },
  darkblue: { name: 'Dark Blue', color: '#3158a6' },
  railroad: { name: 'Railroad', color: '#34414a' },
  utility: { name: 'Utility', color: '#87939a' }
};

const street = (id, name, group, price, mortgage, houseCost, rent) => ({
  id, name, group, kind: 'street', price, mortgage, houseCost, rent
});
const railroad = (id, name) => ({ id, name, group: 'railroad', kind: 'railroad', price: 200, mortgage: 100 });
const utility = (id, name) => ({ id, name, group: 'utility', kind: 'utility', price: 150, mortgage: 75 });

export const PROPERTIES = [
  street('mediterranean', 'Mediterranean Avenue', 'brown', 60, 30, 50, [2, 10, 30, 90, 160, 250]),
  street('baltic', 'Baltic Avenue', 'brown', 60, 30, 50, [4, 20, 60, 180, 320, 450]),
  railroad('reading-railroad', 'Reading Railroad'),
  street('oriental', 'Oriental Avenue', 'lightblue', 100, 50, 50, [6, 30, 90, 270, 400, 550]),
  street('vermont', 'Vermont Avenue', 'lightblue', 100, 50, 50, [6, 30, 90, 270, 400, 550]),
  street('connecticut', 'Connecticut Avenue', 'lightblue', 120, 60, 50, [8, 40, 100, 300, 450, 600]),
  railroad('pennsylvania-railroad', 'Pennsylvania Railroad'),
  street('st-charles', 'St. Charles Place', 'pink', 140, 70, 100, [10, 50, 150, 450, 625, 750]),
  utility('electric-company', 'Electric Company'),
  street('states', 'States Avenue', 'pink', 140, 70, 100, [10, 50, 150, 450, 625, 750]),
  street('virginia', 'Virginia Avenue', 'pink', 160, 80, 100, [12, 60, 180, 500, 700, 900]),
  railroad('bo-railroad', 'B. & O. Railroad'),
  street('st-james', 'St. James Place', 'orange', 180, 90, 100, [14, 70, 200, 550, 750, 950]),
  street('tennessee', 'Tennessee Avenue', 'orange', 180, 90, 100, [14, 70, 200, 550, 750, 950]),
  street('new-york', 'New York Avenue', 'orange', 200, 100, 100, [16, 80, 220, 600, 800, 1000]),
  street('kentucky', 'Kentucky Avenue', 'red', 220, 110, 150, [18, 90, 250, 700, 875, 1050]),
  street('indiana', 'Indiana Avenue', 'red', 220, 110, 150, [18, 90, 250, 700, 875, 1050]),
  street('illinois', 'Illinois Avenue', 'red', 240, 120, 150, [20, 100, 300, 750, 925, 1100]),
  railroad('short-line', 'Short Line'),
  street('atlantic', 'Atlantic Avenue', 'yellow', 260, 130, 150, [22, 110, 330, 800, 975, 1150]),
  street('ventnor', 'Ventnor Avenue', 'yellow', 260, 130, 150, [22, 110, 330, 800, 975, 1150]),
  utility('water-works', 'Water Works'),
  street('marvin-gardens', 'Marvin Gardens', 'yellow', 280, 140, 150, [24, 120, 360, 850, 1025, 1200]),
  street('pacific', 'Pacific Avenue', 'green', 300, 150, 200, [26, 130, 390, 900, 1100, 1275]),
  street('north-carolina', 'North Carolina Avenue', 'green', 300, 150, 200, [26, 130, 390, 900, 1100, 1275]),
  street('pennsylvania-avenue', 'Pennsylvania Avenue', 'green', 320, 160, 200, [28, 150, 450, 1000, 1200, 1400]),
  street('park-place', 'Park Place', 'darkblue', 350, 175, 200, [35, 175, 500, 1100, 1300, 1500]),
  street('boardwalk', 'Boardwalk', 'darkblue', 400, 200, 200, [50, 200, 600, 1400, 1700, 2000])
];

export const PROPERTY_BY_ID = Object.fromEntries(PROPERTIES.map((property) => [property.id, property]));
export const STREET_GROUP_IDS = Object.fromEntries(
  Object.keys(GROUPS).filter((group) => !['railroad', 'utility'].includes(group))
    .map((group) => [group, PROPERTIES.filter((property) => property.group === group).map((property) => property.id)])
);
