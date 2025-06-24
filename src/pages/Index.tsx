import Layout from "@/components/Layout";

const Index = () => {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-full text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to Family Law AI</h1>
        <p className="text-xl text-gray-600">
          Your specialized tool for evidence analysis in California family law cases.
        </p>
        <p className="text-md text-gray-500 mt-4">
          Use the sidebar to navigate.
        </p>
      </div>
    </Layout>
  );
};

export default Index;