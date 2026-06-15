// Helper for spelling-insensitive matching (e.g. th -> t, ignore spaces/specials)
function normalizeSearchTerm(str) {
    if (!str) return '';
    return str.toString().toLowerCase()
        .replace(/th/g, 't')
        .replace(/[^a-z0-9]/g, '');
}

// App State
let allotments = [];
let filteredAllotments = [];
let collegeStats = [];
let uniqueCollegesMap = new Map();
let collegeDetails = {}; // Loaded from colleges_data.json
let map = null;
let activeMarker = null;

// Active Filters State
const filters = {
    searchQuery: '',
    rankMax: 5000,
    college: '',
    branch: '',
    gender: '',
    region: '',
    categories: new Set(),
    myRank: null
};

// Sorting State (Allotments)
const sorting = {
    key: 'rank',
    direction: 'asc' // 'asc' or 'desc'
};

// Sorting State (Colleges Cutoff List)
const collegeSorting = {
    key: 'opening',
    direction: 'asc'
};

// Pagination State
const pagination = {
    currentPage: 1,
    pageSize: 20
};

// DOM Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const allotmentTableBody = document.getElementById('allotmentTableBody');
const collegeStatsTableBody = document.getElementById('collegeStatsTableBody');
const resultsCount = document.getElementById('resultsCount');
const paginationInfo = document.getElementById('paginationInfo');
const paginationControls = document.getElementById('paginationControls');

// Filter Inputs
const searchQueryInput = document.getElementById('searchQuery');
const rankMaxSlider = document.getElementById('rankMax');
const sliderDisplay = document.getElementById('sliderDisplay');
const rankMaxLabel = document.getElementById('rankMaxLabel');
const collegeFilterSelect = document.getElementById('collegeFilter');
const genderToggleGroup = document.getElementById('genderToggleGroup');
const regionFilterSelect = document.getElementById('regionFilter');
const categoryCheckboxesDiv = document.getElementById('categoryCheckboxes');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const pageSizeSelect = document.getElementById('pageSizeSelect');

// Theme Toggling
const themeToggleBtn = document.getElementById('themeToggleBtn');
const moonIcon = document.getElementById('moonIcon');
const sunIcon = document.getElementById('sunIcon');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setupTheme();
    loadDatabase();
    setupEventListeners();
});

// Theme Setup
function setupTheme() {
    const currentTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcons(currentTheme);
    
    themeToggleBtn.addEventListener('click', () => {
        const targetTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', targetTheme);
        localStorage.setItem('theme', targetTheme);
        updateThemeIcons(targetTheme);
        
        // Update map styling if initialized
        if (map) {
            map.setOptions({ styles: getMapStyles(targetTheme) });
        }
    });
}

function updateThemeIcons(theme) {
    if (theme === 'dark') {
        moonIcon.style.display = 'block';
        sunIcon.style.display = 'none';
    } else {
        moonIcon.style.display = 'none';
        sunIcon.style.display = 'block';
    }
}

// Load JSON Database
async function loadDatabase() {
    try {
        // Load college details (addresses, ratings, coords)
        try {
            const detailsResponse = await fetch('colleges_data.json');
            if (detailsResponse.ok) {
                collegeDetails = await detailsResponse.json();
                console.log(`Loaded details for ${Object.keys(collegeDetails).length} colleges.`);
            }
        } catch (e) {
            console.error('Failed to load colleges_data.json:', e);
        }

        const response = await fetch('TGECET_2025_COMPLETE_DATABASE.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        allotments = await response.json();
        console.log(`Loaded ${allotments.length} records.`);
        
        // 1. Build list of unique colleges and branches
        const uniqueBranches = new Set();
        allotments.forEach(item => {
            if (item.college_code && !uniqueCollegesMap.has(item.college_code)) {
                uniqueCollegesMap.set(item.college_code, item.college);
            }
            if (item.branch) {
                uniqueBranches.add(item.branch);
            }
        });
        
        // 2. Initialize filter options
        populateCollegeFilterDropdown();
        populateBranchFilterDropdown(uniqueBranches);
        populateCategoryCheckboxes();
        setupRankSliderLimits();
        
        // 3. Compute initial statistics and dashboard structures
        computeCollegeStats();
        
        // 4. Set active allotments list and run filters
        applyFilters();
        
        // 5. Hide loading screen
        setTimeout(() => {
            loadingOverlay.style.opacity = '0';
            loadingOverlay.style.visibility = 'hidden';
        }, 300);
        
    } catch (err) {
        console.error('Failed to load allotments database:', err);
        document.querySelector('.loading-text').innerHTML = `
            <span style="color: var(--accent-danger)">Failed to load allotment database.</span><br>
            <span style="font-size: 0.9rem; margin-top: 0.5rem; display: block;">Make sure TGECET_2025_COMPLETE_DATABASE.json is generated in the workspace.</span>
        `;
    }
}

// Populate Branch Dropdown
function populateBranchFilterDropdown(uniqueBranches) {
    const branchFilterSelect = document.getElementById('branchFilter');
    if (!branchFilterSelect) return;
    
    // Clear first (keep default "All Branches" option)
    branchFilterSelect.innerHTML = '<option value="">All Branches</option>';
    
    Array.from(uniqueBranches).sort().forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        branchFilterSelect.appendChild(option);
    });
}

// Populate College Dropdown
function populateCollegeFilterDropdown() {
    const sortedCodes = Array.from(uniqueCollegesMap.keys()).sort();
    sortedCodes.forEach(code => {
        const option = document.createElement('option');
        option.value = code;
        // Limit full name length in option
        const fullName = uniqueCollegesMap.get(code);
        const displayName = fullName.length > 50 ? fullName.substring(0, 47) + '...' : fullName;
        option.textContent = `[${code}] ${displayName}`;
        collegeFilterSelect.appendChild(option);
    });
}

// Populate Category Checkboxes
function populateCategoryCheckboxes() {
    const categoriesSet = new Set();
    allotments.forEach(item => {
        if (item.category) categoriesSet.add(item.category);
    });
    
    const sortedCategories = Array.from(categoriesSet).sort();
    categoryCheckboxesDiv.innerHTML = '';
    
    sortedCategories.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = cat;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                filters.categories.add(cat);
            } else {
                filters.categories.delete(cat);
            }
            applyFilters();
        });
        
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(cat));
        categoryCheckboxesDiv.appendChild(label);
    });
}

// Setup Rank Slider Limits dynamically based on data
function setupRankSliderLimits() {
    if (allotments.length === 0) return;
    
    const ranks = allotments.map(item => item.rank);
    const maxRank = Math.max(...ranks);
    const minRank = Math.min(...ranks);
    
    rankMaxSlider.min = minRank;
    rankMaxSlider.max = maxRank;
    rankMaxSlider.value = maxRank;
    
    filters.rankMax = maxRank;
    sliderDisplay.textContent = `${minRank} - ${maxRank.toLocaleString()}`;
    rankMaxLabel.textContent = maxRank.toLocaleString() + '+';
}

// Compute summarized stats for colleges cutoff directory (grouped by college & branch)
function computeCollegeStats() {
    const statsMap = new Map();
    const collegeGenders = {}; // Track genders per college code
    
    allotments.forEach(item => {
        const code = item.college_code;
        const branch = item.branch;
        const name = item.college;
        const rank = item.rank;
        const key = `${code}_${branch}`;
        
        if (!collegeGenders[code]) {
            collegeGenders[code] = { M: 0, F: 0 };
        }
        if (item.gender === 'M') collegeGenders[code].M++;
        if (item.gender === 'F') collegeGenders[code].F++;
        
        if (!statsMap.has(key)) {
            statsMap.set(key, {
                key: key,
                code: code,
                branch: branch,
                name: name,
                opening: rank,
                closing: rank,
                sum: rank,
                count: 1
            });
        } else {
            const stat = statsMap.get(key);
            if (rank < stat.opening) stat.opening = rank;
            if (rank > stat.closing) stat.closing = rank;
            stat.sum += rank;
            stat.count += 1;
        }
    });
    
    collegeStats = Array.from(statsMap.values()).map(stat => {
        const details = collegeDetails[stat.code] || {};
        const genders = collegeGenders[stat.code] || { M: 0, F: 0 };
        const isGirlsOnly = genders.M === 0 && genders.F > 0;
        const isBoysOnly = genders.F === 0 && genders.M > 0;
        const collegeType = isGirlsOnly ? "Women Only" : isBoysOnly ? "Men Only" : "Co-Education";
        
        return {
            ...stat,
            isGirlsOnly: isGirlsOnly,
            isBoysOnly: isBoysOnly,
            collegeType: collegeType,
            average: Math.round(stat.sum / stat.count),
            rating: details.rating !== undefined && details.rating !== null ? parseFloat(details.rating) : 0,
            address: details.address || 'Address not found',
            lat: details.lat || null,
            lng: details.lng || null
        };
    });
    
    sortCollegeStats();
}

// Filter core logic
function applyFilters() {
    filteredAllotments = allotments.filter(item => {
        // Search text matching (Candidate name or College name or College code)
        if (filters.searchQuery) {
            const query = normalizeSearchTerm(filters.searchQuery);
            const candMatch = normalizeSearchTerm(item.cand_name).includes(query);
            const collegeMatch = normalizeSearchTerm(item.college).includes(query);
            const codeMatch = normalizeSearchTerm(item.college_code).includes(query);
            if (!candMatch && !collegeMatch && !codeMatch) return false;
        }
        
        // Rank matching
        if (item.rank > filters.rankMax) return false;
        
        // My Rank filter: show allotments from my rank onwards
        if (filters.myRank !== null && !isNaN(filters.myRank)) {
            if (item.rank < filters.myRank) return false;
        }
        
        // College matching
        if (filters.college && item.college_code !== filters.college) return false;
        
        // Branch matching
        if (filters.branch && item.branch !== filters.branch) return false;
        
        // Gender matching
        if (filters.gender && item.gender !== filters.gender) return false;
        
        // Region matching
        if (filters.region && item.region !== filters.region) return false;
        
        // Category checkboxes matching
        if (filters.categories.size > 0 && !filters.categories.has(item.category)) return false;
        
        return true;
    });
    
    // Reset pagination to first page after filters change
    pagination.currentPage = 1;
    
    // Sort and render allotment list
    sortAllotments();
    
    // Update live dashboard cards based on filtered dataset
    updateDashboardStats();
    
    // Redraw SVG charts reflecting the current filtered query
    renderCharts();
}

// Update the Top 4 Stats Cards dynamically
function updateDashboardStats() {
    const totalCount = filteredAllotments.length;
    resultsCount.textContent = totalCount.toLocaleString();
    
    document.getElementById('statTotalSeats').textContent = totalCount.toLocaleString();
    
    // Calculate unique colleges in filtered dataset
    const colSet = new Set(filteredAllotments.map(item => item.college_code));
    document.getElementById('statCollegesCount').textContent = colSet.size.toLocaleString();
    
    // Calculate rank range
    if (totalCount > 0) {
        const ranks = filteredAllotments.map(item => item.rank);
        const minRank = Math.min(...ranks);
        const maxRank = Math.max(...ranks);
        document.getElementById('statRanksRange').textContent = `${minRank.toLocaleString()} - ${maxRank.toLocaleString()}`;
    } else {
        document.getElementById('statRanksRange').textContent = 'N/A';
    }
    
    // Calculate gender ratio
    const femaleCount = filteredAllotments.filter(item => item.gender === 'F').length;
    const maleCount = filteredAllotments.filter(item => item.gender === 'M').length;
    if (totalCount > 0) {
        const ratio = (femaleCount / (maleCount || 1)).toFixed(2);
        document.getElementById('statGenderRatio').textContent = `${femaleCount}:${maleCount} (${ratio})`;
    } else {
        document.getElementById('statGenderRatio').textContent = 'N/A';
    }
}

// Render dynamic charts (Donut, Region progress bars, and Category bar chart)
function renderCharts() {
    const total = filteredAllotments.length;
    if (total === 0) {
        // Draw empty state in charts
        document.getElementById('legendFemalePct').textContent = '0%';
        document.getElementById('legendMalePct').textContent = '0%';
        document.getElementById('radialFemale').setAttribute('stroke-dashoffset', 314.15);
        document.getElementById('radialMale').setAttribute('stroke-dashoffset', 314.15);
        document.getElementById('donutCenterText').textContent = 'No Data';
        document.getElementById('donutSubText').textContent = 'Filtered out';
        
        document.getElementById('regionOuVal').textContent = '0 (0%)';
        document.getElementById('regionOuBar').style.width = '0%';
        document.getElementById('regionNlVal').textContent = '0 (0%)';
        document.getElementById('regionNlBar').style.width = '0%';
        
        document.getElementById('categoriesChartSvg').innerHTML = `
            <text x="200" y="90" text-anchor="middle" fill="var(--text-muted)">No category data available</text>
        `;
        return;
    }
    
    // 1. Gender Donut Calculation
    const femaleCount = filteredAllotments.filter(item => item.gender === 'F').length;
    const maleCount = total - femaleCount;
    const femalePct = femaleCount / total;
    const malePct = maleCount / total;
    
    document.getElementById('legendFemalePct').textContent = `${Math.round(femalePct * 100)}% (${femaleCount.toLocaleString()})`;
    document.getElementById('legendMalePct').textContent = `${Math.round(malePct * 100)}% (${maleCount.toLocaleString()})`;
    
    const circumference = 314.15; // 2 * PI * 50
    const radialF = document.getElementById('radialFemale');
    const radialM = document.getElementById('radialMale');
    
    radialF.setAttribute('stroke-dashoffset', circumference * (1 - femalePct));
    radialF.setAttribute('transform', 'rotate(-90 75 75)');
    
    radialM.setAttribute('stroke-dashoffset', circumference * (1 - malePct));
    const maleStartAngle = -90 + (femalePct * 360);
    radialM.setAttribute('transform', `rotate(${maleStartAngle} 75 75)`);
    
    document.getElementById('donutCenterText').textContent = total.toLocaleString();
    document.getElementById('donutSubText').textContent = 'Allotments';
    
    // 2. Region Progress Bar Calculation
    const ouCount = filteredAllotments.filter(item => item.region === 'OU').length;
    const nlCount = filteredAllotments.filter(item => item.region === 'NL').length;
    const otherCount = total - ouCount - nlCount;
    
    const ouPct = Math.round((ouCount / total) * 100);
    const nlPct = Math.round((nlCount / total) * 100);
    
    document.getElementById('regionOuVal').textContent = `${ouCount.toLocaleString()} (${ouPct}%)`;
    document.getElementById('regionOuBar').style.width = `${ouPct}%`;
    document.getElementById('regionNlVal').textContent = `${nlCount.toLocaleString()} (${nlPct}%)`;
    document.getElementById('regionNlBar').style.width = `${nlPct}%`;
    
    // 3. Categories Horizontal Bar Chart
    const categoriesMap = new Map();
    filteredAllotments.forEach(item => {
        const cat = item.category || 'Unknown';
        categoriesMap.set(cat, (categoriesMap.get(cat) || 0) + 1);
    });
    
    // Sort categories by frequency and pick top 5
    const sortedCats = Array.from(categoriesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
        
    const maxVal = sortedCats.length > 0 ? sortedCats[0][1] : 1;
    const svg = document.getElementById('categoriesChartSvg');
    
    let svgContent = `
        <defs>
            <linearGradient id="indigoGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="var(--accent-primary)" />
                <stop offset="100%" stop-color="var(--accent-secondary)" />
            </linearGradient>
        </defs>
    `;
    
    sortedCats.forEach((entry, i) => {
        const catName = entry[0];
        const count = entry[1];
        const pctOfMax = count / maxVal;
        const barWidth = Math.max(10, pctOfMax * 240); // Max width in viewBox is 240px
        const y = 15 + i * 32;
        
        svgContent += `
            <text x="10" y="${y + 12}" class="chart-label">${catName}</text>
            <rect x="75" y="${y}" width="250" height="15" class="chart-bar-bg"></rect>
            <rect x="75" y="${y}" width="${barWidth}" height="15" class="chart-bar-fill"></rect>
            <text x="${75 + barWidth + 8}" y="${y + 12}" class="chart-value">${count.toLocaleString()}</text>
        `;
    });
    
    if (sortedCats.length === 0) {
        svgContent += `<text x="200" y="90" text-anchor="middle" fill="var(--text-muted)">No categories found</text>`;
    }
    
    svg.innerHTML = svgContent;
}

// Allotment Sorting
function sortAllotments() {
    const key = sorting.key;
    const dir = sorting.direction === 'asc' ? 1 : -1;
    
    filteredAllotments.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        
        // Handle numeric sorting for rank
        if (key === 'rank') {
            return (valA - valB) * dir;
        }
        
        // Fallback to string comparison
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
}

// Render Allotments Table rows
function renderAllotmentsTable() {
    const start = (pagination.currentPage - 1) * pagination.pageSize;
    const end = Math.min(start + pagination.pageSize, filteredAllotments.length);
    const pageItems = filteredAllotments.slice(start, end);
    
    allotmentTableBody.innerHTML = '';
    
    if (pageItems.length === 0) {
        allotmentTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted)">
                    No allotments match your active filters. Try clearing some filters.
                </td>
            </tr>
        `;
        paginationInfo.textContent = 'Showing 0 to 0 of 0 records';
        return;
    }
    
    pageItems.forEach(item => {
        const tr = document.createElement('tr');
        
        // Style specific items
        const rankSpan = `<span class="rank-val">${item.rank.toLocaleString()}</span>`;
        const genderSpan = `<span class="badge badge-gender-${item.gender.toLowerCase()}">${item.gender}</span>`;
        const branchSpan = `<span class="badge badge-category" style="font-weight: 700;">${item.branch}</span>`;
        const regionSpan = `<span class="badge badge-region">${item.region}</span>`;
        const categorySpan = `<span class="badge badge-category">${item.category}</span>`;
        const collegeCodeSpan = `<span class="college-code-badge">${item.college_code}</span>`;
        
        tr.innerHTML = `
            <td>${rankSpan}</td>
            <td style="font-weight: 500;">${item.cand_name}</td>
            <td>${genderSpan}</td>
            <td>${branchSpan}</td>
            <td class="college-cell" title="${item.college}">
                ${collegeCodeSpan} ${item.college}
            </td>
            <td>${regionSpan}</td>
            <td>${categorySpan}</td>
            <td style="font-family: monospace; font-size: 0.85rem;">${item.seat_category}</td>
        `;
        
        allotmentTableBody.appendChild(tr);
    });
    
    paginationInfo.textContent = `Showing ${(start + 1).toLocaleString()} to ${end.toLocaleString()} of ${filteredAllotments.length.toLocaleString()} records`;
}

// Render Pagination Controls
function renderPaginationControls() {
    const totalPages = Math.ceil(filteredAllotments.length / pagination.pageSize);
    
    // Clear previous numbers but keep arrows
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    prevBtn.disabled = pagination.currentPage === 1;
    nextBtn.disabled = pagination.currentPage === totalPages || totalPages === 0;
    
    // Remove all numeric page buttons
    const numButtons = paginationControls.querySelectorAll('.page-btn-num');
    numButtons.forEach(btn => btn.remove());
    
    if (totalPages <= 1) return;
    
    // Calculate pages to show (sliding window of 5 pages)
    let startPage = Math.max(1, pagination.currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `page-btn page-btn-num ${i === pagination.currentPage ? 'active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => {
            pagination.currentPage = i;
            renderAllotmentsTable();
            renderPaginationControls();
        });
        
        // Insert before next arrow button
        paginationControls.insertBefore(btn, nextBtn);
    }
}

// Sort College Cutoffs list
function sortCollegeStats() {
    const key = collegeSorting.key;
    const dir = collegeSorting.direction === 'asc' ? 1 : -1;
    
    collegeStats.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        
        // Handle numeric sorting
        if (key === 'opening' || key === 'closing' || key === 'average' || key === 'allotments' || key === 'rating') {
            const numA = key === 'allotments' ? a.count : a[key];
            const numB = key === 'allotments' ? b.count : b[key];
            return (numA - numB) * dir;
        }
        
        // String sort (code, name)
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
}

// Render College Cutoffs table
function renderCollegeStatsTable(query = '') {
    collegeStatsTableBody.innerHTML = '';
    
    const myRank = filters.myRank;
    const eligibilityHeader = document.getElementById('eligibilityHeader');
    const hasRank = myRank !== null && !isNaN(myRank);
    
    if (hasRank) {
        if (eligibilityHeader) eligibilityHeader.style.display = 'table-cell';
    } else {
        if (eligibilityHeader) eligibilityHeader.style.display = 'none';
    }
    
    const normalizedQuery = normalizeSearchTerm(query);
    const rows = collegeStats.filter(stat => {
        if (normalizedQuery) {
            const matchesSearch = normalizeSearchTerm(stat.code).includes(normalizedQuery) || 
                                  normalizeSearchTerm(stat.name).includes(normalizedQuery);
            if (!matchesSearch) return false;
        }
        
        if (hasRank) {
            // Show colleges where rank is within opening and closing range
            return stat.opening <= myRank && stat.closing >= myRank;
        }
        
        return true;
    });
    
    if (rows.length === 0) {
        collegeStatsTableBody.innerHTML = `
            <tr>
                <td colspan="${hasRank ? 8 : 7}" style="text-align: center; padding: 3rem; color: var(--text-muted)">
                    No colleges match your search or rank eligibility criteria.
                </td>
            </tr>
        `;
        return;
    }
    
    // Get absolute max cutoff in dataset for visual bar rendering scale
    const absoluteMaxClosing = Math.max(...collegeStats.map(s => s.closing));
    
    rows.forEach(stat => {
        const tr = document.createElement('tr');
        tr.className = 'college-row-detail';
        
        // Visual indicator of average rank popularity (shorter bar = more competitive / lower rank number)
        const avgPercent = Math.min(100, Math.max(5, (stat.average / absoluteMaxClosing) * 100));
        
        let eligibilityTd = '';
        if (hasRank) {
            let chance = '';
            let color = '';
            let bg = '';
            
            if (myRank <= stat.opening) {
                chance = 'Very High';
                color = '#10b981'; // Green
                bg = 'rgba(16, 185, 129, 0.15)';
            } else if (myRank <= stat.average) {
                chance = 'Good';
                color = '#06b6d4'; // Cyan
                bg = 'rgba(6, 182, 212, 0.15)';
            } else {
                chance = 'Borderline';
                color = '#f59e0b'; // Amber
                bg = 'rgba(245, 158, 11, 0.15)';
            }
            eligibilityTd = `<td><span class="badge" style="background: ${bg}; color: ${color}; border: 1px solid ${color}33; font-weight: 700; padding: 0.25rem 0.6rem;">${chance}</span></td>`;
        }
        
        const ratingVal = parseFloat(stat.rating);
        const ratingHtml = ratingVal > 0 
            ? `<span class="badge badge-rating">⭐ ${ratingVal.toFixed(1)}</span>`
            : `<span class="badge" style="background: var(--bg-input); color: var(--text-muted);">N/A</span>`;

        const typeClass = stat.collegeType.toLowerCase().replace(' ', '-');
        tr.innerHTML = `
            <td><span class="college-code-badge">${stat.code}</span></td>
            <td><span class="badge badge-category" style="font-weight: 700;">${stat.branch}</span></td>
            <td style="font-weight: 500; white-space: normal; min-width: 250px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start;">
                        <span style="line-height: 1.3;">${stat.name}</span>
                        <span class="rf-card-type badge-type-${typeClass}" style="margin-left: 0; font-size: 0.65rem; padding: 0.15rem 0.45rem;">${stat.collegeType}</span>
                    </div>
                    <button class="clear-btn explore-link-btn" style="font-size: 0.75rem; white-space: nowrap; padding: 0.1rem 0.4rem; border: 1px solid var(--accent-primary); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.2rem; cursor: pointer; background: transparent;">
                        📊 Explore
                    </button>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.35rem; white-space: normal; font-weight: normal; line-height: 1.3;">
                    📍 ${stat.address}
                </div>
            </td>
            <td>${ratingHtml}</td>
            <td class="rank-val">${stat.opening.toLocaleString()}</td>
            <td class="rank-val" style="color: var(--accent-warning);">${stat.closing.toLocaleString()}</td>
            <td>
                <div style="display: flex; align-items: center;">
                    <span class="cutoff-trend-bar" style="width: ${avgPercent}px;"></span>
                    <span class="rank-val" style="color: var(--text-primary)">${stat.average.toLocaleString()}</span>
                </div>
            </td>
            <td style="font-weight: 600; text-align: center;">${stat.count.toLocaleString()}</td>
            ${eligibilityTd}
        `;
        
        // Handle clicking the "Explore" button to swap tabs and filter
        const exploreBtn = tr.querySelector('.explore-link-btn');
        exploreBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent row click map centering
            
            filters.college = stat.code;
            collegeFilterSelect.value = stat.code;
            
            filters.branch = stat.branch;
            document.getElementById('branchFilter').value = stat.branch;
            
            // Switch back to Tab 1
            const dashboardTabBtn = document.querySelector('.tab-btn[data-tab="dashboardTab"]');
            dashboardTabBtn.click();
            
            applyFilters();
        });
        
        // Clicking a college row centers map and places a marker!
        tr.addEventListener('click', () => {
            // Highlight row
            document.querySelectorAll('.college-row-detail').forEach(r => r.classList.remove('selected-row'));
            tr.classList.add('selected-row');

            // Update map details card
            document.getElementById('map-active-college').textContent = `[${stat.code}] ${stat.name.split(',')[0]}`;
            document.getElementById('map-active-address').textContent = stat.address;

            // Highlight on Google Maps
            selectCollegeOnMap(stat);
        });
        
        collegeStatsTableBody.appendChild(tr);
    });
}

// Export Allotments to CSV File
function exportFilteredDataToCSV() {
    if (filteredAllotments.length === 0) {
        alert('No data to export.');
        return;
    }
    
    const headers = ['college_code', 'college_name', 'branch_code', 'branch_name_full', 'college', 'branch_name', 'branch', 'rank', 'cand_name', 'gender', 'region', 'category', 'seat_category'];
    let csvRows = [headers.join(',')];
    
    filteredAllotments.forEach(item => {
        const values = headers.map(header => {
            let val = item[header];
            // Escape double quotes inside values, wrap strings containing commas in quotes
            if (typeof val === 'string') {
                const escaped = val.replace(/"/g, '""');
                return `"${escaped}"`;
            }
            return val;
        });
        csvRows.push(values.join(','));
    });
    
    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `tgecet_2025_allotments_filtered_${timestamp}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
}

// Event Listeners wiring
function setupEventListeners() {
    // 1. Text Search Input
    searchQueryInput.addEventListener('input', (e) => {
        filters.searchQuery = e.target.value;
        applyFilters();
    });
    
    // 2. Rank Range Slider
    rankMaxSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        filters.rankMax = val;
        
        const minRank = parseInt(rankMaxSlider.min, 10);
        sliderDisplay.textContent = `${minRank} - ${val.toLocaleString()}`;
        applyFilters();
    });
    
    // 3. College Filter Dropdown
    collegeFilterSelect.addEventListener('change', (e) => {
        filters.college = e.target.value;
        applyFilters();
    });
    
    // 4. Gender Toggle Button Group
    const genderButtons = genderToggleGroup.querySelectorAll('button');
    genderButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            genderButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filters.gender = btn.getAttribute('data-gender');
            applyFilters();
        });
    });
    
    // 5. Region Selector Dropdown
    regionFilterSelect.addEventListener('change', (e) => {
        filters.region = e.target.value;
        applyFilters();
    });
    
    // 6. Clear All Filters Button
    clearFiltersBtn.addEventListener('click', () => {
        // Reset state
        filters.searchQuery = '';
        filters.college = '';
        filters.branch = '';
        filters.gender = '';
        filters.region = '';
        filters.categories.clear();
        filters.myRank = null;
        
        const maxRank = parseInt(rankMaxSlider.max, 10);
        filters.rankMax = maxRank;
        rankMaxSlider.value = maxRank;
        
        const minRank = parseInt(rankMaxSlider.min, 10);
        sliderDisplay.textContent = `${minRank} - ${maxRank.toLocaleString()}`;
        
        // Reset DOM elements
        searchQueryInput.value = '';
        collegeFilterSelect.value = '';
        document.getElementById('branchFilter').value = '';
        regionFilterSelect.value = '';
        document.getElementById('myRankInput').value = '';
        document.getElementById('predictorSummary').style.display = 'none';
        
        genderButtons.forEach(btn => btn.classList.remove('active'));
        genderButtons[0].classList.add('active'); // "All"
        
        const checkboxes = categoryCheckboxesDiv.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
        
        applyFilters();
        renderCollegeStatsTable(document.getElementById('collegeSearch').value);
    });
    
    // 7. Allotment Table Columns Sorting
    const tableHeaders = document.querySelectorAll('#allotmentTable th[data-sort]');
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            
            if (sorting.key === key) {
                sorting.direction = sorting.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sorting.key = key;
                sorting.direction = 'asc';
            }
            
            // Update active header CSS indicators
            tableHeaders.forEach(h => {
                h.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(sorting.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            
            sortAllotments();
            renderAllotmentsTable();
            renderPaginationControls();
        });
    });
    
    // 8. Cutoffs Directory Columns Sorting
    const collegeHeaders = document.querySelectorAll('#collegeStatsTable th[data-col-sort]');
    collegeHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-col-sort');
            
            if (collegeSorting.key === key) {
                collegeSorting.direction = collegeSorting.direction === 'asc' ? 'desc' : 'asc';
            } else {
                collegeSorting.key = key;
                collegeSorting.direction = 'asc';
            }
            
            collegeHeaders.forEach(h => {
                h.classList.remove('sort-asc', 'sort-desc');
            });
            th.classList.add(collegeSorting.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            
            sortCollegeStats();
            renderCollegeStatsTable(document.getElementById('collegeSearch').value);
        });
    });
    
    // 9. Page size selector
    pageSizeSelect.addEventListener('change', (e) => {
        pagination.pageSize = parseInt(e.target.value, 10);
        pagination.currentPage = 1;
        renderAllotmentsTable();
        renderPaginationControls();
    });
    
    // 10. Pagination Next/Prev button clicks
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (pagination.currentPage > 1) {
            pagination.currentPage--;
            renderAllotmentsTable();
            renderPaginationControls();
        }
    });
    
    // 11. Pagination Next button click
    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.ceil(filteredAllotments.length / pagination.pageSize);
        if (pagination.currentPage < totalPages) {
            pagination.currentPage++;
            renderAllotmentsTable();
            renderPaginationControls();
        }
    });
    
    // 12. Tab Swapper Button listeners
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetTab = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(targetTab).classList.add('active');
            
            // Refresh table representations when tab wakes up
            if (targetTab === 'collegesTab') {
                renderCollegeStatsTable();
            } else {
                renderAllotmentsTable();
                renderPaginationControls();
            }
        });
    });
    
    // 13. College Search input inside tab 2 Cutoffs
    document.getElementById('collegeSearch').addEventListener('input', (e) => {
        renderCollegeStatsTable(e.target.value);
    });
    
    // 14. Export current dataset CSV button
    exportCsvBtn.addEventListener('click', () => {
        exportFilteredDataToCSV();
    });

    // 15. Rank Eligibility Predictor Input
    const myRankInput = document.getElementById('myRankInput');
    const predictorSummary = document.getElementById('predictorSummary');
    const predictorCount = document.getElementById('predictorCount');
    const viewEligibleBtn = document.getElementById('viewEligibleBtn');
    
    if (myRankInput) {
        myRankInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (isNaN(val) || val <= 0) {
                filters.myRank = null;
                predictorSummary.style.display = 'none';
            } else {
                filters.myRank = val;
                
                // Calculate count of eligible college-branch choices
                const eligibleColleges = collegeStats.filter(c => c.closing >= val);
                predictorCount.textContent = eligibleColleges.length;
                predictorSummary.style.display = 'block';
            }
            
            // Re-filter dashboards and tables
            applyFilters();
            renderCollegeStatsTable(document.getElementById('collegeSearch').value);
        });
    }
    
    if (viewEligibleBtn) {
        viewEligibleBtn.addEventListener('click', () => {
            const collegesTabBtn = document.querySelector('.tab-btn[data-tab="collegesTab"]');
            if (collegesTabBtn) collegesTabBtn.click();
        });
    }

    // 16. Branch Filter Dropdown
    const branchFilterSelect = document.getElementById('branchFilter');
    if (branchFilterSelect) {
        branchFilterSelect.addEventListener('change', (e) => {
            filters.branch = e.target.value;
            applyFilters();
        });
    }

    // 17. Rank Finder Tab - Search Button & Enter Key
    const rankFinderInput = document.getElementById('rankFinderInput');
    const rankFinderSearchBtn = document.getElementById('rankFinderSearchBtn');
    
    if (rankFinderSearchBtn) {
        rankFinderSearchBtn.addEventListener('click', () => {
            performRankFinderSearch();
        });
    }
    
    if (rankFinderInput) {
        rankFinderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                performRankFinderSearch();
            }
        });
    }
    
    // 18. Rank Finder Branch Filter
    const rfBranchFilter = document.getElementById('rfBranchFilter');
    if (rfBranchFilter) {
        rfBranchFilter.addEventListener('change', () => {
            renderRankFinderResults();
        });
    }
    
    // 19. Rank Finder Sort By
    const rfSortBy = document.getElementById('rfSortBy');
    if (rfSortBy) {
        rfSortBy.addEventListener('change', () => {
            renderRankFinderResults();
        });
    }
    
    // 20. Rank Finder Search Query Input
    const rfSearchQuery = document.getElementById('rfSearchQuery');
    if (rfSearchQuery) {
        rfSearchQuery.addEventListener('input', () => {
            renderRankFinderResults();
        });
    }
    
    // 21. Rank Finder College Type Filter Input
    const rfTypeFilter = document.getElementById('rfTypeFilter');
    if (rfTypeFilter) {
        rfTypeFilter.addEventListener('change', () => {
            populateRFBranchFilter();
            renderRankFinderResults();
        });
    }
    
    // 22. Export PDF Button
    const rfExportPdfBtn = document.getElementById('rfExportPdfBtn');
    if (rfExportPdfBtn) {
        rfExportPdfBtn.addEventListener('click', () => {
            exportRankFinderToPDF();
        });
    }
}

// Rank Finder: cached rank for current search
let rankFinderCurrentRank = null;

// Perform the rank finder search
function performRankFinderSearch() {
    const input = document.getElementById('rankFinderInput');
    const rank = parseInt(input.value, 10);
    
    if (isNaN(rank) || rank <= 0) {
        // Shake animation feedback
        input.style.borderColor = 'var(--accent-danger)';
        input.style.animation = 'none';
        input.offsetHeight; // force reflow
        input.style.animation = 'shakeInput 0.4s ease';
        setTimeout(() => {
            input.style.borderColor = '';
            input.style.animation = '';
        }, 500);
        return;
    }
    
    rankFinderCurrentRank = rank;
    
    // Reset search query input when a new search starts
    const rfSearchInput = document.getElementById('rfSearchQuery');
    if (rfSearchInput) {
        rfSearchInput.value = '';
    }
    
    // Populate the branch filter dropdown with branches available in eligible colleges
    populateRFBranchFilter();
    
    // Show filters and summary
    document.getElementById('rankFinderFilters').style.display = 'flex';
    
    // Render results
    renderRankFinderResults();
}

// Helper to get active stats array based on selected college type filter in Rank Finder
function getActiveRFStats() {
    const typeFilter = document.getElementById('rfTypeFilter');
    const val = typeFilter ? typeFilter.value : '';
    if (val) {
        return collegeStats.filter(c => c.collegeType === val);
    }
    return collegeStats;
}

// Populate the Rank Finder branch filter dropdown from eligible colleges
function populateRFBranchFilter() {
    const rfBranchFilter = document.getElementById('rfBranchFilter');
    if (!rfBranchFilter) return;
    
    const stats = getActiveRFStats();
    const allColleges = stats.filter(c => c.opening <= rankFinderCurrentRank && c.closing >= rankFinderCurrentRank);
    const branches = new Set(allColleges.map(c => c.branch));
    
    rfBranchFilter.innerHTML = '<option value="">All Branches</option>';
    Array.from(branches).sort().forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        rfBranchFilter.appendChild(option);
    });
}

// Generate star rating HTML
function generateStarRating(rating) {
    if (!rating || rating <= 0) {
        return '<span class="rf-rating-na">No rating</span>';
    }
    
    let starsHtml = '<div class="rf-rating-stars">';
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.3;
    
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) {
            starsHtml += '<span class="rf-star filled">★</span>';
        } else if (i === fullStars + 1 && hasHalf) {
            starsHtml += '<span class="rf-star half">★</span>';
        } else {
            starsHtml += '<span class="rf-star">★</span>';
        }
    }
    starsHtml += '</div>';
    starsHtml += `<span class="rf-rating-num">${parseFloat(rating).toFixed(1)}</span>`;
    
    return starsHtml;
}

// Render rank finder results as card grid
function renderRankFinderResults() {
    const resultsContainer = document.getElementById('rankFinderResults');
    const summaryContainer = document.getElementById('rankFinderSummary');
    const rank = rankFinderCurrentRank;
    
    if (!rank) return;
    
    // Get filter values
    const searchVal = normalizeSearchTerm(document.getElementById('rfSearchQuery').value);
    const branchFilter = document.getElementById('rfBranchFilter').value;
    const sortBy = document.getElementById('rfSortBy').value;
    
    const stats = getActiveRFStats();
    
    // Show colleges where rank lies between the opening and closing ranks
    let eligible = stats.filter(c => c.opening <= rank && c.closing >= rank);
    
    // Apply search filter
    if (searchVal) {
        eligible = eligible.filter(c => 
            normalizeSearchTerm(c.code).includes(searchVal) || 
            normalizeSearchTerm(c.name).includes(searchVal)
        );
    }
    
    // Apply branch filter
    if (branchFilter) {
        eligible = eligible.filter(c => c.branch === branchFilter);
    }
    
    // Calculate admission chance for each
    eligible = eligible.map(c => {
        let chance, chanceClass, chanceIcon;
        
        if (rank <= c.opening) {
            chance = 'Very High';
            chanceClass = 'very-high';
            chanceIcon = '🟢';
        } else if (rank <= c.average) {
            chance = 'Good';
            chanceClass = 'good';
            chanceIcon = '🔵';
        } else if (rank <= c.closing) {
            chance = 'Borderline';
            chanceClass = 'borderline';
            chanceIcon = '🟡';
        } else {
            chance = 'Low';
            chanceClass = 'low';
            chanceIcon = '🔴';
        }
        
        return { ...c, chance, chanceClass, chanceIcon, chancePriority: chance === 'Very High' ? 1 : chance === 'Good' ? 2 : chance === 'Borderline' ? 3 : 4 };
    });
    
    // Sort
    switch (sortBy) {
        case 'chance':
            eligible.sort((a, b) => {
                if (a.chancePriority !== b.chancePriority) return a.chancePriority - b.chancePriority;
                return (b.rating || 0) - (a.rating || 0);
            });
            break;
        case 'rating':
            eligible.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            break;
        case 'opening':
            eligible.sort((a, b) => a.opening - b.opening);
            break;
        case 'closing':
            eligible.sort((a, b) => a.closing - b.closing);
            break;
        case 'intake':
            eligible.sort((a, b) => b.count - a.count);
            break;
    }
    
    // Update summary strip
    summaryContainer.style.display = 'flex';
    document.getElementById('rfsRank').textContent = rank.toLocaleString();
    document.getElementById('rfsCount').textContent = eligible.length;
    
    if (eligible.length > 0) {
        // Best match = highest rated college with Very High chance
        const bestMatch = eligible.reduce((best, c) => {
            if ((c.rating || 0) > (best.rating || 0)) return c;
            return best;
        }, eligible[0]);
        document.getElementById('rfsBest').textContent = `⭐ ${parseFloat(bestMatch.rating || 0).toFixed(1)} - ${bestMatch.code}`;
    } else {
        document.getElementById('rfsBest').textContent = '-';
    }
    
    // Render cards
    resultsContainer.innerHTML = '';
    
    if (eligible.length === 0) {
        resultsContainer.innerHTML = `
            <div class="rank-finder-no-results">
                <div class="rfnr-icon">😔</div>
                <div class="rfnr-text">No colleges found for rank ${rank.toLocaleString()}</div>
                <div class="rfnr-subtext">Try entering a different rank or remove branch filters</div>
            </div>
        `;
        return;
    }
    
    eligible.forEach((college, index) => {
        const card = document.createElement('div');
        card.className = `rf-college-card chance-${college.chanceClass}`;
        card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;
        
        const typeClass = college.collegeType.toLowerCase().replace(' ', '-');
        card.innerHTML = `
            <div class="rf-card-header">
                <div style="display: flex; gap: 0.35rem; align-items: center;">
                    <span class="rf-card-code">${college.code}</span>
                    <span class="rf-card-branch">${college.branch}</span>
                    <span class="rf-card-type badge-type-${typeClass}">${college.collegeType}</span>
                </div>
            </div>
            <div class="rf-card-name">${college.name}</div>
            <div class="rf-card-address">📍 ${college.address}</div>
            <div class="rf-card-rating">
                ${generateStarRating(college.rating)}
            </div>
            <div class="rf-card-stats">
                <div class="rf-stat">
                    <span class="rf-stat-label">Opening</span>
                    <span class="rf-stat-value opening">${college.opening.toLocaleString()}</span>
                </div>
                <div class="rf-stat">
                    <span class="rf-stat-label">Closing</span>
                    <span class="rf-stat-value closing">${college.closing.toLocaleString()}</span>
                </div>
                <div class="rf-stat">
                    <span class="rf-stat-label">Intake</span>
                    <span class="rf-stat-value intake">${college.count.toLocaleString()}</span>
                </div>
            </div>
            <div class="rf-card-chance">
                <span class="rf-chance-badge ${college.chanceClass}">
                    <span class="rf-chance-icon">${college.chanceIcon}</span>
                    ${college.chance}
                </span>
                <button class="rf-card-explore-btn">📊 Explore</button>
            </div>
        `;
        
        // Explore button navigates to tab 1 with college filter
        const exploreBtn = card.querySelector('.rf-card-explore-btn');
        exploreBtn.addEventListener('click', () => {
            filters.college = college.code;
            collegeFilterSelect.value = college.code;
            filters.branch = college.branch;
            document.getElementById('branchFilter').value = college.branch;
            
            const dashboardTabBtn = document.querySelector('.tab-btn[data-tab="dashboardTab"]');
            dashboardTabBtn.click();
            applyFilters();
        });
        
        resultsContainer.appendChild(card);
    });
}

// Export Rank Finder results to PDF, sorted by rating highest to lowest
function exportRankFinderToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });
    
    // Get currently active rank
    const rank = rankFinderCurrentRank;
    if (!rank) return;
    
    // Retrieve eligible list based on current filters
    const stats = getActiveRFStats();
    let eligible = stats.filter(c => c.closing >= rank);
    
    const searchVal = normalizeSearchTerm(document.getElementById('rfSearchQuery').value);
    const branchFilter = document.getElementById('rfBranchFilter').value;
    
    if (searchVal) {
        eligible = eligible.filter(c => 
            normalizeSearchTerm(c.code).includes(searchVal) || 
            normalizeSearchTerm(c.name).includes(searchVal)
        );
    }
    if (branchFilter) {
        eligible = eligible.filter(c => c.branch === branchFilter);
    }
    
    // Sort by rating (highest to lowest)
    eligible.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    
    // Prepare table columns and rows: Rating, College Name, Location, Intake
    const headers = [['Rating', 'College Name', 'Location (Address)', 'Intake']];
    const data = eligible.map(c => [
        c.rating > 0 ? c.rating.toFixed(1) : 'N/A',
        `[${c.code}] ${c.name} (${c.branch})\nType: ${c.collegeType}`,
        c.address || 'Address not found',
        c.count.toString()
    ]);
    
    // Add Document Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(31, 41, 55); // Dark grey
    doc.text("AllotIQ Portal - Eligible Colleges List", 14, 15);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128); // Muted grey
    const typeVal = document.getElementById('rfTypeFilter').value;
    const typeText = typeVal ? typeVal : 'All Colleges';
    const branchText = branchFilter ? branchFilter : 'All Branches';
    doc.text(`Rank: ${rank.toLocaleString()}  |  Type: ${typeText}  |  Branch: ${branchText}  |  Total: ${eligible.length} colleges`, 14, 21);
    
    // Generate Table using autoTable plugin
    doc.autoTable({
        head: headers,
        body: data,
        startY: 26,
        theme: 'striped',
        headStyles: {
            fillColor: [99, 102, 241], // Indigo primary theme color
            textColor: [255, 255, 255],
            fontSize: 9,
            fontStyle: 'bold'
        },
        bodyStyles: {
            fontSize: 8,
            textColor: [55, 65, 81]
        },
        columnStyles: {
            0: { cellWidth: 15, halign: 'center' }, // Rating
            1: { cellWidth: 75 },                  // College Name
            2: { cellWidth: 80 },                  // Address
            3: { cellWidth: 15, halign: 'center' }  // Intake
        },
        margin: { top: 25, bottom: 15, left: 14, right: 14 },
        didDrawPage: function(data) {
            // Footer page number
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(156, 163, 175);
            doc.text(`Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`, 14, doc.internal.pageSize.height - 10);
            doc.text("Generated By AllotIQ Portal Based on 2025 Ecet admission data Developed By NotAyaz...", doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 10, { align: "right" });
        }
    });
    
    // Save PDF
    doc.save(`TGECET_2025_Colleges_Rank_${rank}.pdf`);
}

// Global update callers
function updateAllotmentView() {
    renderAllotmentsTable();
    renderPaginationControls();
}

// Intercept filter calls to run view refreshers
const originalSortAllotments = sortAllotments;
sortAllotments = function() {
    originalSortAllotments();
    updateAllotmentView();
};

// Google Maps API Initializer callback
window.initMap = function() {
    console.log("Google Maps API loaded successfully.");
    const defaultLocation = { lat: 17.3850, lng: 78.4867 }; // Hyderabad center
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    
    map = new google.maps.Map(document.getElementById('map-side'), {
        center: defaultLocation,
        zoom: 10,
        styles: getMapStyles(activeTheme),
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true
    });
};

// Select and center a college on the map
function selectCollegeOnMap(stat) {
    if (!map || !stat.lat || !stat.lng) return;

    const pos = { lat: parseFloat(stat.lat), lng: parseFloat(stat.lng) };

    // Clear active marker
    if (activeMarker) {
        activeMarker.setMap(null);
    }

    // Create marker
    activeMarker = new google.maps.Marker({
        position: pos,
        map: map,
        title: stat.name,
        animation: google.maps.Animation.DROP
    });

    // Center and zoom map to location
    map.setCenter(pos);
    map.setZoom(14);

    // Info window with styled layout matching the dark/light theme
    const contentString = `
        <div style="color: #0f172a; padding: 0.5rem; max-width: 250px; font-family: sans-serif;">
            <h4 style="margin: 0 0 0.25rem 0; font-size: 0.95rem; color: #4f46e5;">[${stat.code}] ${stat.name.split(',')[0]}</h4>
            <div style="font-size: 0.8rem; color: #fbbf24; font-weight: bold; margin-bottom: 0.5rem;">⭐ ${parseFloat(stat.rating).toFixed(1)} Rating</div>
            <div style="font-size: 0.75rem; color: #475569; margin-bottom: 0.5rem; line-height: 1.3;">📍 ${stat.address}</div>
            <div style="font-size: 0.75rem; border-top: 1px solid #e2e8f0; padding-top: 0.4rem; display: flex; justify-content: space-between;">
                <span>Intake: <strong>${stat.count}</strong></span>
                <span>Cutoff Rank: <strong style="color: #d97706;">${stat.closing.toLocaleString()}</strong></span>
            </div>
        </div>
    `;

    const infoWindow = new google.maps.InfoWindow({
        content: contentString
    });

    // Open info window immediately
    infoWindow.open(map, activeMarker);

    // Event listener to reopen on click
    activeMarker.addListener('click', () => {
        infoWindow.open(map, activeMarker);
    });
}

// Custom Slate-Dark theme styles for Google Maps
function getMapStyles(theme) {
    if (theme === 'light') return [];
    return [
        { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#1e293b" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
        {
            featureType: "administrative.locality",
            elementType: "labels.text.fill",
            stylers: [{ color: "#f8fafc" }],
        },
        {
            featureType: "poi",
            elementType: "labels.text.fill",
            stylers: [{ color: "#38bdf8" }],
        },
        {
            featureType: "poi.park",
            elementType: "geometry",
            stylers: [{ color: "#0f172a" }],
        },
        {
            featureType: "poi.park",
            elementType: "labels.text.fill",
            stylers: [{ color: "#475569" }],
        },
        {
            featureType: "road",
            elementType: "geometry",
            stylers: [{ color: "#334155" }],
        },
        {
            featureType: "road",
            elementType: "geometry.stroke",
            stylers: [{ color: "#1e293b" }],
        },
        {
            featureType: "road.highway",
            elementType: "geometry",
            stylers: [{ color: "#475569" }],
        },
        {
            featureType: "road.highway",
            elementType: "geometry.stroke",
            stylers: [{ color: "#1e293b" }],
        },
        {
            featureType: "water",
            elementType: "geometry",
            stylers: [{ color: "#0f172a" }],
        },
        {
            featureType: "water",
            elementType: "labels.text.fill",
            stylers: [{ color: "#475569" }],
        },
    ];
}

