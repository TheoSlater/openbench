use super::{Tool, RegistryInner};
use openbench_macros::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

// ===========================================================================
//  TOOL TEMPLATE & GUIDE
// ===========================================================================
// 
// This file serves as a reference for creating and registering new tools
// into the OpenBench ecosystem.
// 
// ARCHITECTURE OVERVIEW:
// 1. Tool Traits: All tools implement the `Tool` trait, typically via the
//    `#[derive(Tool)]` custom macro which handles JSON schema generation and 
//    argument deserialization.
// 2. Registry: Tools must be registered in `SharedToolRegistry` (managed in AppState).
// 3. MCP Compatible: The design aligns with MCP (Model Context Protocol)
//    schemas, ensuring future-proofing.
//
// HOW TO ADD A NEW TOOL:
// ... (rest of comments)

/// 1. Define arguments (optional). 
/// The `///` doc comments here become the descriptions in the JSON Schema sent to the LLM.
#[derive(JsonSchema, Deserialize)]
pub struct ExampleArgs {
    /// Provide a helpful description for what this argument does
    pub example_param: String,
}

/// 2. Define the tool struct.
/// Configure the name, description, the argument struct, and if the user needs to approve it.
#[derive(Tool)]
#[tool(
    name = "example_tool", 
    description = "An example tool to demonstrate how to build integrations.", 
    args = "ExampleArgs", 
    requires_approval = false
)]
pub struct ExampleTool;

/// 3. Implement the tool execution logic.
/// The `#[derive(Tool)]` macro automatically sets up the trait implementation that deserializes
/// the JSON payload and calls this `run` method automatically.
impl ExampleTool {
    pub async fn run(&self, args: ExampleArgs) -> Result<String, String> {
        // Implement your logic here...
        // For example:
        println!("The LLM passed the parameter: {}", args.example_param);
        
        // Return Ok(String) on success, or Err(String) on failure.
        Ok(format!("Successfully executed example tool with param: {}", args.example_param))
    }
}

// ---------------------------------------------------------------------------
// Example without arguments
// ---------------------------------------------------------------------------

#[derive(Tool)]
#[tool(
    name = "example_tool_no_args", 
    description = "An example tool that doesn't take any arguments.", 
    requires_approval = false
)]
pub struct ExampleNoArgsTool;

impl ExampleNoArgsTool {
    // If there are no arguments, `run()` should just take `&self`.
    pub async fn run(&self) -> Result<String, String> {
        Ok("Successfully executed argument-less tool!".to_string())
    }
}
