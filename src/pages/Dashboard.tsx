import Layout from "@/components/Layout";

const Dashboard = () => {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-full text-center">
        <h1 className="text-4xl font-bold mb-4">Dashboard</h1>
        <p className="text-xl text-gray-600">
          Overview of your cases and analysis progress.
        </p>
      </div>
    </Layout>
  );
};

export default Dashboard;