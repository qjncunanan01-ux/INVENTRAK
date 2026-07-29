const { app, seedDatabase } = require('./app');

seedDatabase();
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`Backend server running on ${PORT}`));
