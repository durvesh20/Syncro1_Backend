const Fuse = require('fuse.js');
const countryData = require('../utils/countries+states+cities.json'); // Your original nested JSON

class CityService {
    constructor() {
        this.allCities = this._flattenCities();
        
        // Configure Fuse.js for fuzzy search
        this.fuse = new Fuse(this.allCities, {
            keys: ['name'],
            threshold: 0.4,           // Lower = stricter, Higher = more fuzzy (0.4 is good balance)
            distance: 100,
            minMatchCharLength: 2,
            shouldSort: true,
            includeScore: true
        });

        console.log(`✅ Loaded ${this.allCities.length} cities for fuzzy search`);
    }

    /**
     * Flatten nested structure (Country -> States -> Cities) into flat array
     */
    _flattenCities() {
        const flattened = [];

        countryData.states.forEach(state => {
            if (state.cities && Array.isArray(state.cities)) {
                state.cities.forEach(city => {
                    flattened.push({
                        id: city.id,
                        name: city.name,
                        stateId: state.id,
                        stateName: state.name,
                        stateIso2: state.iso2
                    });
                });
            }
        });

        return flattened;
    }

    /**
     * Get city suggestions with fuzzy search + state filter
     */
    async getCitySuggestions(query, stateName = null, limit = 12) {
        if (!query || query.trim().length < 2) {
            return [];
        }

        const searchTerm = query.trim();

        // Perform fuzzy search on all cities
        const searchResults = this.fuse.search(searchTerm);

        let suggestions = searchResults.map(result => ({
            id: result.item.id,
            name: result.item.name,
            state: result.item.stateName,
            stateId: result.item.stateId,
            score: result.score
        }));

        // Filter by state if provided
        if (stateName) {
            const targetState = stateName.trim().toLowerCase();
            suggestions = suggestions.filter(city => 
                city.state.toLowerCase() === targetState
            );
        }

        return suggestions.slice(0, limit);
    }
}

module.exports = new CityService();