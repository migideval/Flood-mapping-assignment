var beforeStart = '2021-01-01';
var beforeEnd = '2021-03-01';
var afterStart = '2021-04-05';
var afterEnd = '2021-06-16';

// Import your constituency shapefile


// Check your attribute name!
var nyando = constituency.filter(ee.Filter.eq('const_nam','Nyando'));
var geometry = nyando.geometry();

Map.addLayer(geometry, {color: 'blue'}, 'Nyando Constituency');

Map.centerObject(geometry, 10);

// Import Sentinel-1
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD');

var filtered = s1
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
    .filter(ee.Filter.eq('resolution_meters', 10))
    .filterBounds(geometry)
    .select('VH');

var beforeCollection = filtered.filterDate(beforeStart, beforeEnd);
var afterCollection = filtered.filterDate(afterStart, afterEnd);

var listDates = filtered.aggregate_array('system:time_start')
    .map(function(time) { return ee.Date(time).format('YYYY-MM-dd'); });
print('Available image dates:', listDates);

print('Total filtered images:', filtered.size());
print('Before period images:', beforeCollection.size());
print('After period images:', afterCollection.size());

var before = beforeCollection.mosaic().clip(geometry);
var after = afterCollection.mosaic().clip(geometry);

Map.addLayer(before, {min:-25, max:0}, 'Before Floods', false);
Map.addLayer(after, {min:-25, max:0}, 'After Floods', false);
function toNatural(img) {
  return ee.Image(10.0).pow(img.select(0).divide(10.0));
}

function toDB(img) {
  return ee.Image(img).log10().multiply(10.0);
}

// RefinedLee definition...
function RefinedLee(img) {
  // your entire long function code here
}
var beforeFiltered = toDB(RefinedLee(toNatural(before)));

var afterFiltered = toDB(RefinedLee(toNatural(after)));

Map.addLayer(before, {min:-25, max:0}, 'Before Filtered', false);
Map.addLayer(after, {min:-25, max:0}, 'After Filtered', false);

var difference = after.divide(before);
var diffThreshold = 1.25;

var flooded1 = difference.gt(diffThreshold).rename('water').selfMask();
Map.addLayer(flooded1, {min: 0, max: 1, palette: ['orange']}, 'Initial Flood Estimate');

// Permanent water masking
var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');
var seasonality = gsw.select('seasonality');
var permanentWater = seasonality.gte(5).clip(geometry);

var flooded = flooded1.updateMask(permanentWater.not());

// Slope filtering
var dem = ee.Image('USGS/SRTMGL1_003').clip(geometry);
var terrain = ee.Algorithms.Terrain(dem);
var slope = terrain.select('slope');
var slopeThreshold = 5;
flooded = flooded.updateMask(slope.lt(slopeThreshold));

// Connectivity filtering
var connectedPixelsThreshold = 2;
var connections = flooded.connectedPixelCount(25);
flooded = flooded.updateMask(connections.gt(connectedPixelsThreshold));

Map.addLayer(flooded, {min:0, max:1, palette: ['red']}, 'Flooded Area', false);

print('Total District Area (Ha):', geometry.area().divide(10000));

var stats = flooded.multiply(ee.Image.pixelArea()).reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e10,
  tileScale: 16
});

var flooded_area = ee.Algorithms.If(
  stats.get('water'),
  ee.Number(stats.get('water')).divide(10000),
  0
);

print('Flooded Area (Ha):', flooded_area);

// Export vector
var floodedVector = flooded
  .reduceToVectors({
    geometry: geometry,
    scale: 30,
    geometryType: 'polygon',
    labelProperty: 'water',
    maxPixels: 1e13
  });

var sentinel2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(geometry)
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',10));
                
var sent2_before = sentinel2.filter(ee.Filter.date(beforeStart, beforeEnd)).median().clip(geometry);
var sent2_after = sentinel2.filter(ee.Filter.date(afterStart, afterEnd)).median().clip(geometry);


Map.addLayer(sent2_before,{min:0.0,max:3000,bands:['B4','B3','B2']},'RGB BEFORE');
Map.addLayer(sent2_after,{min:0.0,max:3000,bands:['B4','B3','B2']},'RGB AFTER');

Export.image.toDrive({
  image: flooded1,
  description: 'Initial_flood_estimate_mask',
  crs: 'EPSG:4326',
  folder:'flood_mapping_mask',
  region: geometry,
  fileNamePrefix:'Initial_flood_estimate_mask',
  scale:10,
  maxPixels:1e10
});

Export.image.toDrive({
  image: sent2_before.select('B4','B3','B2'),
  description: 'RGB_EXPORT',
  crs: 'EPSG:4326',
  folder:'flood_mapping_mask',
  region: geometry,
  fileNamePrefix:'RGB_BEFORE',
  scale:10,
  maxPixels:1e10
});

Export.image.toDrive({
  image: sent2_after.select('B4','B3','B2'),
  description: 'RGB_EXPORT2',
  crs: 'EPSG:4326',
  folder:'flood_mapping_mask',
  region: geometry,
  fileNamePrefix:'RGB_AFTER',
  scale:10,
  maxPixels:1e10
});

// ------- SPECKLE FILTERING FUNCTIONS -------

function toNatural(img) {
  return ee.Image(10.0).pow(img.select(0).divide(10.0));
}

function toDB(img) {
  return ee.Image(img).log10().multiply(10.0);
}
floodedVector.size().evaluate(function(size) {
  print('Flooded vector features:', size);
  if (size > 0) {
    Export.table.toDrive({
      collection: floodedVector,
      description: 'Nyando_Flooded_Areas_2021',
      folder: 'Flooded_Areas',
      fileFormat: 'SHP'
    });
  } else {
    print('No flooded areas detected. Nothing to export.');
  }
});
